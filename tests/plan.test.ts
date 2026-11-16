// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achieve, applyPlanForecast, buildPlanTree, parseMonthHeader, parsePlanGrid, planMapOf, type PlanLv3, type PlanSourceRow } from '../lib/plan.ts';

const row = (l3: string, l3t: string, fcst: number): PlanSourceRow => ({
  l1: l3.slice(0, 3),
  l1t: '더미식',
  l2: l3.slice(0, 8),
  l2t: '즉석밥',
  l3,
  l3t,
  mtd: fcst / 2,
  fcst,
  prev: 0,
});
const plan = (ym: string, l3: string, sales: number): PlanLv3 => ({ ym, l3, l3t: `계획 ${l3}`, sales });

test('계획 맵: 같은 달·LV3 합산, 다른 달 무시', () => {
  const m = planMapOf([plan('202611', 'A01B000010001', 100), plan('202611', 'A01B000010001', 50), plan('202610', 'A01B000010001', 999)], '202611');
  assert.deepEqual(m['A01B000010001'], { sales: 150, l3t: '계획 A01B000010001' });
});

test('트리: LV3 실적 합산, 계획 없는 LV3는 달성률 분자에서 빠진다', () => {
  const rows = [row('A01B000010001', '흰밥', 80), row('A01B000010001', '흰밥', 40), row('A01B000010002', '잡곡밥', 30)];
  const t = buildPlanTree(rows, 'fcst', planMapOf([plan('202611', 'A01B000010001', 100)], '202611'));
  assert.equal(t.nodes.length, 1);
  assert.equal(t.nodes[0].children[0].children.length, 2);
  assert.equal(t.total.actual, 150);
  assert.equal(t.total.plan, 100);
  assert.equal(t.total.plannedActual, 120);
  assert.equal(t.total.lv3, 2);
  assert.equal(t.total.planned, 1);
  assert.equal(achieve(t.total.plannedActual, t.total.plan), 1.2);
});

test('매출 없는 계획 LV3도 코드 앞자리로 상위 계층에 붙는다', () => {
  const t = buildPlanTree([row('A01B000010001', '흰밥', 80)], 'fcst', planMapOf([plan('202611', 'A01C000020009', 50)], '202611'));
  assert.equal(t.nodes.length, 1); // 같은 LV1 'A01'
  assert.deepEqual(t.nodes[0].children.map((c) => c.key).sort(), ['A01B0000', 'A01C0000']);
  const planOnly = t.nodes[0].children.find((c) => c.key === 'A01C0000')!;
  assert.equal(planOnly.actual, 0);
  assert.equal(planOnly.plan, 50);
});

test('누계 보기: 계획 × 진행률', () => {
  const t = buildPlanTree([row('A01B000010001', '흰밥', 80)], 'mtd', planMapOf([plan('202611', 'A01B000010001', 100)], '202611'), 0.3);
  assert.equal(t.total.plan, 30);
  assert.equal(t.total.actual, 40);
});

test('달성률: 계획 0 이하면 없음', () => {
  assert.equal(achieve(10, 0), null);
  assert.equal(achieve(10, null), null);
});

test('시트 월 머리글: 여러 표기를 YYYYMM으로', () => {
  assert.equal(parseMonthHeader('2026-11'), '202611');
  assert.equal(parseMonthHeader('202611'), '202611');
  assert.equal(parseMonthHeader(202601), '202601');
  assert.equal(parseMonthHeader('2026년 3월'), '202603');
  assert.equal(parseMonthHeader('2026.13'), null);
  assert.equal(parseMonthHeader('LV3명'), null);
});

test('시트 파싱: 행 = LV3, 월 열 금액, 빈 칸·코드 없는 행 건너뜀', () => {
  const g = parsePlanGrid([
    ['LV1', 'LV2', 'LV3코드', 'LV3명', '참고', '2026-11', '메모', '2026-12'],
    ['더미식', '즉석밥', 'A01B000010001', '흰밥', 300, '1,000,000', 'x', ''],
    ['', '', '', '합계', 0, 5, '', 5],
    ['더미식', '즉석밥', 'A01B000010002', '잡곡밥', 100, '', '', 200],
  ]);
  assert.deepEqual(g.months, [{ ym: '202611', col: 5 }, { ym: '202612', col: 7 }]);
  assert.deepEqual(g.rows, [{ l3: 'A01B000010001', row: 2 }, { l3: 'A01B000010002', row: 4 }]);
  assert.deepEqual(g.plans, [
    { ym: '202611', l3: 'A01B000010001', l3t: '흰밥', sales: 1_000_000 },
    { ym: '202612', l3: 'A01B000010002', l3t: '잡곡밥', sales: 200 },
  ]);
});

test('예상 = 계획: LV3 안 행들을 예상 매출 비중으로, 원가·수량은 같은 배수, 비용은 그대로', () => {
  const amt = (sales: number, cogs: number) => ({ sales, qty: sales / 10, cogs, incentive: 7, general: 3 });
  const rows = [
    { l3: 'A', fcst: amt(60, 30) },
    { l3: 'A', fcst: amt(40, 20) },
    { l3: 'B', fcst: amt(50, 25) },
  ];
  const res = applyPlanForecast(rows, { A: { sales: 200, l3t: 'A' }, C: { sales: 80, l3t: '신제품' } });
  assert.deepEqual(rows[0].fcst, { sales: 120, qty: 12, cogs: 60, incentive: 7, general: 3 });
  assert.deepEqual(rows[1].fcst, { sales: 80, qty: 8, cogs: 40, incentive: 7, general: 3 });
  assert.deepEqual(rows[2].fcst, amt(50, 25)); // 계획 없는 LV3는 그대로
  assert.equal(res.lv3, 1);
  assert.equal(res.sales, 200);
  assert.deepEqual(res.skipped, [{ l3: 'C', l3t: '신제품', sales: 80 }]); // 당월 매출이 없어 나눌 곳 없음
});
