// node --test tests/segment.test.ts  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutValue, inScope, migration, paretoCut, pareto, quadrantOf, segment, toUnits, unitValue, type Cut, type SegProduct } from '../lib/segment.ts';

// a[i] = [매출, 수량, 원가, 장려금, 일반비], 기간 순서 ytd · fcst · prev · prev2. 범위 단계는 CM › PM
type Q = [number, number, number, number];
const five = ([s, q, c, inc]: Q): [number, number, number, number, number] => [s, q, c, inc, 0];
const P = (matnr: string, cm: string, owner: string, fcst: Q, prev: Q = [0, 0, 0, 0]): SegProduct => ({
  matnr,
  name: matnr,
  cm,
  cmMark: cm,
  owner,
  category: owner,
  l1t: cm,
  a: [five(fcst), five(fcst), five(prev), [0, 0, 0, 0, 0]],
});

const products = [
  P('m1', 'A', 'A1', [600, 6, 400, 50], [500, 5, 300, 0]), // 영업이익 150
  P('m2', 'A', 'A2', [250, 5, 300, 0], [300, 6, 200, 0]), // 영업이익 −50
  P('m3', 'B', 'B1', [100, 1, 50, 0], [0, 0, 0, 0]), // 영업이익 50
  P('m4', 'B', 'B1', [50, 1, 60, 0], [100, 1, 50, 0]), // 영업이익 −10
  P('m5', 'B', 'B2', [0, 0, 0, 0], [100, 1, 80, 0]), // 이번 기간 실적 없음
];
const cut = (method: Cut['method'], extra: Partial<Cut> = {}): Cut => ({ method, pareto: 0.8, manual: 0, ...extra });

test('파레토 기준선: 큰 순 누적이 처음 80%에 닿는 값', () => {
  assert.equal(paretoCut([600, 250, 100, 50], 0.8), 250); // 600/1000 → 850/1000
  assert.equal(paretoCut([-5, 0], 0.8), null);
});

test('사분면: 기준선 이상이 ↑', () => {
  assert.equal(quadrantOf(10, 10, 5, 5), 'A');
  assert.equal(quadrantOf(1, 10, 5, 5), 'C');
  assert.equal(quadrantOf(10, 1, 5, 5), 'B');
  assert.equal(quadrantOf(5, 5, 5, 5), 'A');
  assert.equal(quadrantOf(1, 1, 5, 5), 'D');
});

test('매출 파레토 × 영업이익 0 기준 세그먼트, 실적 없는 제품 제외', () => {
  const units = toUnits(products, 'product');
  const seg = segment(units, 'fcst', 'sales', 'op', cut('pareto'), cut('zero'))!;
  assert.equal(seg.cx, 250);
  assert.equal(seg.cy, 0);
  const q = Object.fromEntries(seg.points.map((p) => [p.unit.key, p.q]));
  assert.deepEqual(q, { m1: 'A', m2: 'B', m3: 'C', m4: 'D' });
});

test('계층 범위를 좁히면 기준선이 그 안에서 다시 계산된다', () => {
  const units = toUnits(inScope(products, ['B']), 'product');
  const seg = segment(units, 'fcst', 'sales', 'op', cut('median'), cut('zero'))!;
  assert.equal(seg.cx, 75); // B 안의 m3·m4 중앙값
  assert.deepEqual(seg.points.map((p) => p.q), ['A', 'D']); // 전체 기준이면 C였던 m3이 A가 된다
});

test('하위 계층 묶음과 비율 지표의 가중평균 기준선', () => {
  const units = toUnits(products, 'cm');
  assert.deepEqual(units.map((u) => [u.key, u.count, u.amt[1].sales]), [['A', 2, 850], ['B', 3, 150]]);
  // 전체 GP율 = (순매출 950 − 원가 810) / 순매출 950 (순매출 = 총매출 1000 − 장려금 50)
  assert.ok(Math.abs(cutValue(units, 'fcst', 'gpm', cut('mean'))! - 140 / 950) < 1e-9);
  // 성장률: 비교 기간(prev) 매출이 0이면 값 없음
  assert.equal(unitValue(toUnits(products, 'product')[2], 'fcst', 'growth'), null);
  assert.ok(Math.abs(unitValue(units[0], 'fcst', 'growth')! - (850 / 800 - 1)) < 1e-9);
});

test('파레토 등급: 경계를 넘기는 항목까지 핵심, 0 이하는 손실·없음', () => {
  const { rows, total } = pareto(toUnits(products, 'product'), 'fcst', 'op');
  assert.equal(total, 200);
  assert.deepEqual(rows.map((r) => [r.unit.key, r.band]), [['m1', 'core'], ['m3', 'core'], ['m4', 'none'], ['m2', 'none']]);
  assert.equal(rows[1].cum, 1);
});

test('순매출 = 총매출 − 장려금, 기준 금액 이상이 ↑', () => {
  const units = toUnits(products, 'product');
  assert.equal(unitValue(units[0], 'fcst', 'net'), 550); // 600 − 50
  assert.equal(unitValue(units[1], 'fcst', 'net'), 250); // 판관비 미입력이면 총매출과 같다
  const seg = segment(units, 'fcst', 'net', 'op', cut('manual', { manual: 250 }), cut('zero'))!;
  assert.deepEqual(Object.fromEntries(seg.points.map((p) => [p.unit.key, p.q])), { m1: 'A', m2: 'B', m3: 'C', m4: 'D' });
});

test('기간 간 세그먼트 이동', () => {
  const units = toUnits(products, 'product');
  const before = segment(units, 'prev', 'sales', 'op', cut('manual', { manual: 200 }), cut('zero'))!;
  const after = segment(units, 'fcst', 'sales', 'op', cut('manual', { manual: 200 }), cut('zero'))!;
  const cells = migration(before, after);
  // m1 A→A, m2 A→B, m4 C→D (m3은 전월 실적 없음, m5는 이번 기간 실적 없음)
  assert.deepEqual(Object.fromEntries(cells), { AA: ['m1'], AB: ['m2'], CD: ['m4'] });
});
