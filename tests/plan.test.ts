// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achieve, buildPlanTree, planMapOf, type PlanLv3, type PlanSourceRow } from '../lib/plan.ts';

const amt = (sales: number, qty: number) => ({ sales, qty });
const row = (l3: string, l3t: string, fcst: number, qty = 0): PlanSourceRow => ({
  l1: l3.slice(0, 3),
  l1t: '더미식',
  l2: l3.slice(0, 8),
  l2t: '즉석밥',
  l3,
  l3t,
  mtd: amt(fcst / 2, qty / 2),
  fcst: amt(fcst, qty),
  prev: amt(0, 0),
});
const plan = (ym: string, l3: string, sales: number, qty = 0): PlanLv3 => ({ ym, l3, l3t: `계획 ${l3}`, sales, qty, updatedAt: '', updatedBy: '' });

test('계획 맵: 같은 달·LV3 합산, 다른 달 무시', () => {
  const m = planMapOf([plan('202611', 'A01B000010001', 100, 10), plan('202611', 'A01B000010001', 50, 5), plan('202610', 'A01B000010001', 999)], '202611');
  assert.deepEqual(m['A01B000010001'], { sales: 150, qty: 15, l3t: '계획 A01B000010001' });
});

test('트리: LV3 실적 합산, 계획 없는 LV3는 달성률 분모에서 빠진다', () => {
  const rows = [row('A01B000010001', '흰밥', 80, 8), row('A01B000010001', '흰밥', 40, 4), row('A01B000010002', '잡곡밥', 30)];
  const t = buildPlanTree(rows, 'fcst', planMapOf([plan('202611', 'A01B000010001', 100, 10)], '202611'));
  assert.equal(t.nodes.length, 1);
  const l2 = t.nodes[0].children[0];
  assert.equal(l2.children.length, 2);
  assert.deepEqual(t.total.actual, { sales: 150, qty: 12 });
  assert.deepEqual(t.total.plan, { sales: 100, qty: 10 });
  assert.deepEqual(t.total.plannedActual, { sales: 120, qty: 12 });
  assert.equal(t.total.lv3, 2);
  assert.equal(t.total.planned, 1);
  assert.equal(achieve(t.total.plannedActual.sales, t.total.plan?.sales), 1.2);
});

test('매출 없는 계획 LV3도 코드 앞자리로 상위 계층에 붙는다', () => {
  const t = buildPlanTree([row('A01B000010001', '흰밥', 80)], 'fcst', planMapOf([plan('202611', 'A01C000020009', 50)], '202611'));
  assert.equal(t.nodes.length, 1); // 같은 LV1 'A01'
  assert.deepEqual(t.nodes[0].children.map((c) => c.key).sort(), ['A01B0000', 'A01C0000']);
  const planOnly = t.nodes[0].children.find((c) => c.key === 'A01C0000')!;
  assert.deepEqual(planOnly.actual, { sales: 0, qty: 0 });
  assert.equal(planOnly.plan?.sales, 50);
});

test('누계 보기: 계획 × 진행률', () => {
  const t = buildPlanTree([row('A01B000010001', '흰밥', 80)], 'mtd', planMapOf([plan('202611', 'A01B000010001', 100)], '202611'), 0.3);
  assert.equal(t.total.plan?.sales, 30);
  assert.equal(t.total.actual.sales, 40);
});

test('달성률: 계획 0 이하면 없음', () => {
  assert.equal(achieve(10, 0), null);
  assert.equal(achieve(10, undefined), null);
});
