// node --test tests/grade.test.ts  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeChanges, gradeOf, gradePair } from '../lib/grade.ts';
import { ORPHAN_NAME } from '../lib/pnl.ts';
import { gradeTrend, shiftLabel } from '../lib/segment.ts';
import type { Amounts, MaterialRow } from '../lib/types.ts';

const M = 1e6;
// [총매출, 원가, 장려금] 백만원 → Amounts
const A = (sales: number, cogs: number, incentive = 0): Amounts => ({ sales: sales * M, qty: sales ? 1 : 0, cogs: cogs * M, incentive: incentive * M, general: 0 });
const Z = A(0, 0);
const R = (matnr: string, ch: string, prev: Amounts, fcst: Amounts, prev2: Amounts = Z): MaterialRow =>
  ({ matnr, name: matnr, ch, cht: ch, mtd: fcst, fcst, prev, prev2 }) as unknown as MaterialRow;

test('등급: 순매출 5천만원 이상 = 규모↑, 영업이익 0 이상 = 손익+ (A·C 손익+, B·D 손익−)', () => {
  assert.equal(gradeOf(A(80, 60)), 'A');
  assert.equal(gradeOf(A(80, 90)), 'B');
  assert.equal(gradeOf(A(30, 20)), 'C');
  assert.equal(gradeOf(A(30, 40)), 'D');
  assert.equal(gradeOf(A(60, 40, 20)), 'C'); // 순매출 = 총매출 − 장려금 = 40
  assert.equal(gradeOf(Z), null);
});

test('좋은 순서 A > C > B > D, 손익 부호가 바뀌면 흑자·적자 전환', () => {
  assert.equal(gradeTrend('A', 'C'), 'down');
  assert.equal(gradeTrend('C', 'B'), 'down');
  assert.equal(gradeTrend('B', 'C'), 'up');
  assert.equal(gradeTrend('D', 'D'), 'same');
  assert.equal(gradeTrend(null, 'A'), 'new');
  assert.equal(gradeTrend('A', null), 'gone');
  assert.equal(shiftLabel('A', 'B'), '적자 전환');
  assert.equal(shiftLabel('D', 'C'), '흑자 전환');
  assert.equal(shiftLabel('A', 'C'), '규모 축소');
  assert.equal(shiftLabel('D', 'B'), '규모 확대');
});

test('제품별은 채널을 합쳐 한 등급, 채널별은 제품 × 채널마다 등급', () => {
  const rows = [
    R('m1', 'c1', A(40, 30), A(40, 50)),
    R('m1', 'c2', A(40, 30), A(40, 30)),
    R('m2', 'c1', Z, A(10, 5)),
    { ...R('x', 'c1', A(0, 1), Z), name: ORPHAN_NAME },
  ];
  const byProduct = Object.fromEntries(gradeChanges(rows, false, 'prev', 'fcst').map((c) => [c.key, [c.from, c.to, c.trend]]));
  // m1 합계: 전월 순매출 80 · OP 20 → A, 당월 순매출 80 · OP 0 → A (0 이상은 손익+)
  assert.deepEqual(byProduct, { m1: ['A', 'A', 'same'], m2: [null, 'C', 'new'] });
  const byChannel = Object.fromEntries(gradeChanges(rows, true, 'prev', 'fcst').map((c) => [c.key, [c.from, c.to, c.shift]]));
  assert.deepEqual(byChannel['m1|c1'], ['C', 'D', '적자 전환']);
  assert.deepEqual(byChannel['m1|c2'], ['C', 'C', null]);
});

test('화면 기간별 비교: 누계·예상은 전월 → 당월 예상, 전월 실적은 전전월 → 전월', () => {
  assert.deepEqual(gradePair('mtd'), { from: 'prev', to: 'fcst' });
  assert.deepEqual(gradePair('prev'), { from: 'prev2', to: 'prev' });
});
