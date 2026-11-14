// 장려금 시트 순수 계산 (lib/incentive.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incentiveGroups, INCENTIVE_HEADER, newSheetRows, parseIncentiveRows, recordKey, recordsToInputs, summarize, tabTitle } from '../lib/incentive.ts';
import type { ChannelFact } from '../lib/types.ts';

const f = (matnr: string, sg: string, ch: string, sales: number): ChannelFact => ({ matnr, ch, cht: `고객${ch}`, sg, sgt: `영업${sg}`, sales, qty: 0, cogs: 0 });
const cat: Record<string, string> = { a: '면', b: '면', c: '즉석밥', r: '소스' };

test('매출 있는 조합만, 영업그룹·고객그룹·카테고리 매출 큰 순', () => {
  const groups = incentiveGroups(
    [f('a', 'S1', '01', 100), f('b', 'S1', '01', 50), f('c', 'S1', '01', 300), f('a', 'S1', '02', 900), f('r', 'S1', '02', -5), f('x', 'S2', '01', 2000), f('a', 'S1', '03', 0)],
    (m) => cat[m] ?? '',
  );
  assert.deepEqual(groups.map((g) => g.sg), ['S2', 'S1']);
  assert.deepEqual(groups[0].cells.map((c) => [c.ch, c.cat]), [['01', '(미매핑)']]);
  // S1: 고객 02(900) → 01(450). 01 안에서 즉석밥 300 → 면 150. 소스(-5)·고객 03(0)은 뺀다
  assert.deepEqual(groups[1].cells.map((c) => [c.ch, c.cat, c.sales]), [['02', '면', 900], ['01', '즉석밥', 300], ['01', '면', 150]]);
});

test('시트 행 → 기록: 10개 항목 합, 쉼표 숫자, 빈 키 버림, 같은 키는 합산', () => {
  const row = (ym: string | number, sg: string, ch: string, c: string, ...items: (string | number)[]) => [ym, sg, ch, `고객${ch}`, c, ...items];
  const recs = parseIncentiveRows(
    [
      row(202611, 'S1', '01', '면', 100, '1,000', '', 5),
      row('202611', 'S1', '01', '면', 1),
      row('202611', '', '01', '면', 999),
      row('2026-11', 'S1', '01', '면', 999),
      row(202611, 'S1', '02', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 777),
    ],
    '영업S1',
  );
  assert.equal(recs.length, 2);
  assert.equal(recs[0].total, 1106);
  assert.equal(recs[0].sgt, '영업S1');
  assert.equal(recs[1].cat, '(미매핑)');
  assert.equal(recs[1].total, 10); // 합계 열(P)은 읽지 않는다
  const inputs = recordsToInputs([...recs, { ...recs[0], ch: '09', total: 0 }]);
  assert.equal(inputs.length, 2);
  assert.deepEqual([inputs[0].by, inputs[0].sg, inputs[0].ch, inputs[0].cat, inputs[0].incentive], ['cell', 'S1', '01', '면', 1106]);
  const s = summarize([...recs, { ...recs[0], ch: '09', total: 0 }], '202611');
  assert.deepEqual(s, [{ sg: 'S1', sgt: '영업S1', rows: 3, filled: 2, total: 1116 }]);
});

test('새 행: 이미 있는 키는 빼고, 코드는 문자 그대로', () => {
  const [g] = incentiveGroups([f('a', 'S1', '01', 100), f('c', 'S1', '01', 50)], (m) => cat[m] ?? '');
  const rows = newSheetRows('202611', g, new Set([recordKey('202611', 'S1', '01', '즉석밥')]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, INCENTIVE_HEADER.length);
  assert.deepEqual(rows[0].slice(0, 5), [202611, "'S1", "'01", "'고객01", "'면"]);
});

test('탭 이름: 허용 안 되는 문자 제거', () => {
  assert.equal(tabTitle('대형/마트:1팀', 'S1'), '대형 마트 1팀');
  assert.equal(tabTitle('  ', 'S1'), '영업그룹 S1');
});
