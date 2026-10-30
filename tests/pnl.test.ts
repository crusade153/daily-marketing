// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate,
  applyLineOwners,
  lv1InputsFor,
  spreadChannel,
  buildMonthRows,
  buildRows,
  cmOf,
  cmRank,
  estimateCogs,
  costRates,
  forecastFactor,
  groupBy,
  metrics,
  ORPHAN_NAME,
  totalOf,
  unitPrice,
} from '../lib/pnl.ts';
import { getPeriods, progressOf, shiftYm, ymRange } from '../lib/period.ts';
import { pricePoints } from '../lib/price.ts';
import { aggregateTrend, buildBridge, metricValue } from '../lib/trend.ts';
import type { Hierarchy, ManualInput, MaterialFact, MonthFact } from '../lib/types.ts';

const H = (l1: string, l2: string, l3 = `${l2}0`, l4 = `${l3}0`): Hierarchy => ({
  l1,
  l1t: l1,
  l2,
  l2t: l2,
  l3,
  l3t: l3,
  l4,
  l4t: l4,
});

const fact = (o: Partial<MaterialFact>): MaterialFact => ({
  matnr: 'M',
  name: 'n',
  ...H('A', 'A1'),
  curSales: 0,
  curQty: 0,
  prevSales: 0,
  prevQty: 0,
  prevCogs: 0,
  costQty: 0,
  costSales: 0,
  costCogs: 0,
  ...o,
});

const input = (ym: string, l1: string, incentive: number, general: number): ManualInput => ({
  ym,
  l1,
  l1t: l1,
  incentive,
  general,
  updatedAt: '',
  updatedBy: '',
});

test('기간: 10월 기준 전월 9월, 원가 평균 7~9월, 31일', () => {
  const p = getPeriods('20261013');
  assert.equal(p.curYm, '202610');
  assert.equal(p.prevYm, '202609');
  assert.deepEqual(p.costYms, ['202607', '202608', '202609']);
  assert.equal(p.daysInMonth, 31);
  assert.equal(p.prevEnd, '20260930');
  assert.equal(shiftYm('202601', -1), '202512');
  assert.equal(getPeriods('20260215').costStart, '20251101');
  assert.deepEqual(ymRange('202611', '202602'), []);
  assert.equal(ymRange('202601', '202609').length, 9);
});

test('진행률: 10일 ÷ 31일', () => {
  const pr = progressOf('20261010', 31);
  assert.equal(pr.elapsed, 10);
  assert.ok(Math.abs(pr.rate - 10 / 31) < 1e-12);
  assert.equal(forecastFactor(10, 31), 3.1);
  assert.equal(forecastFactor(0, 31), 0);
});

test('매출원가: 3개월 단위원가 × 당월 수량, 이력 없으면 계층 원가율', () => {
  const a = fact({ matnr: 'a', curQty: 10, curSales: 2000, costQty: 30, costCogs: 3000, costSales: 6000 });
  const b = fact({ matnr: 'b', curQty: 5, curSales: 1000 });
  const rates = costRates([a, b]);
  assert.deepEqual(estimateCogs(a, rates), { cogs: 1000, method: 'unit' });
  assert.deepEqual(estimateCogs(b, rates), { cogs: 500, method: 'rate' }); // A1 원가율 0.5
});

test('CM: 표시한 열 이름, X·빈칸은 미소속, 둘 이상이면 중복', () => {
  const m = (cm1: string, cm2: string, cm3: string, etc = '') => ({ matnr: 'a', name: 'n', cm1, cm2, cm3, etc, category: '', owner: '' });
  assert.equal(cmOf(m('○', '', '')), 'CM1');
  assert.equal(cmOf(m('X', 'x', 'v')), 'CM3');
  assert.equal(cmOf(m('', '', '', '○')), '기타');
  assert.equal(cmOf(m('', '', '')), '(미매핑)');
  assert.equal(cmOf(undefined), '(미매핑)');
  assert.equal(cmOf(m('○', '', '', '○')), '(CM 중복)');
});

test('배분: 양(+)의 매출 비중, 가중치 없으면 null', () => {
  assert.deepEqual(allocate(100, [30, 70, -10]), [30, 70, 0]);
  assert.equal(allocate(100, [0, -5]), null);
});

test('buildRows: LV1 입력을 LV1 안 제품 매출 비중으로 배부, 예상 확장·진행률·합계 보존', () => {
  const facts = [
    fact({ matnr: 'a', ...H('A', 'A1'), curSales: 300, curQty: 3, costQty: 10, costCogs: 500, costSales: 1000, prevSales: 900, prevQty: 9, prevCogs: 400 }),
    fact({ matnr: 'b', ...H('A', 'A2'), curSales: 100, curQty: 1, costQty: 10, costCogs: 500, costSales: 1000, prevSales: 100, prevQty: 1, prevCogs: 50 }),
    fact({ matnr: 'c', ...H('B', 'B1'), curSales: 50, curQty: 5, costQty: 10, costCogs: 100, costSales: 200 }),
  ];
  const rows = buildRows({
    facts,
    maps: [{ matnr: 'a', name: 'n', cm1: '', cm2: '○', cm3: '', etc: '', category: '', owner: '홍길동' }],
    curInputs: [input('202610', 'A', 40, 20), input('202610', 'ZZ', 7, 3)],
    prevInputs: [input('202609', 'A', 50, 10)],
    elapsed: 10,
    daysInMonth: 31,
  });
  const t = totalOf(rows);
  assert.ok(Math.abs(t.fcst.sales - 450 * 3.1) < 1e-9);
  assert.ok(Math.abs(t.fcst.incentive - 47) < 1e-9); // 매출 없는 LV1(ZZ)도 합계에 남는다
  assert.ok(Math.abs(t.mtd.general - 23 * (10 / 31)) < 1e-9);
  assert.equal(t.prev.incentive, 50);
  const a = rows.find((r) => r.matnr === 'a')!;
  assert.equal(a.fcst.incentive, 30); // LV2가 달라도 같은 LV1이면 300/(300+100) × 40
  assert.equal(a.prev.incentive, 45); // 900/1000 × 50
  assert.equal(rows.find((r) => r.matnr === 'c')!.fcst.incentive, 0); // 다른 LV1에는 배부 안 됨
  assert.equal(a.owner, '홍길동');
  assert.equal(a.mtd.qty, 3);
  assert.ok(Math.abs(a.fcst.qty - 9.3) < 1e-9);
  assert.equal(a.prev.qty, 9);
  assert.equal(unitPrice(a.mtd), 100);
  assert.equal(unitPrice({ sales: 100, qty: 0 }), null);
  assert.equal(a.cm, 'CM2');
  assert.equal(rows.find((r) => r.matnr === 'b')!.cm, '(미매핑)');
  assert.ok(rows.some((r) => r.matnr === 'L1:ZZ'));
  // LV2로 묶어도 LV1 입력 합계 보존
  const byL2 = groupBy(rows, 'l2');
  assert.ok(Math.abs(byL2.reduce((s, g) => s + g.fcst.incentive, 0) - 47) < 1e-9);
  assert.equal(byL2.find((g) => g.key === 'A1')!.label, 'A1');
  const m = metrics(t.prev);
  assert.equal(m.gp, 1000 - 450);
  assert.equal(m.op, 550 - 60);
  assert.equal(m.opm, 0.49);
});

test('마감월: CO-PA 실적 + 그 달 LV1 입력 배부, 매출 없는 LV1은 별도 행', () => {
  const mf = (matnr: string, l2: string, sales: Record<string, number>, cogs: Record<string, number>): MonthFact => ({
    matnr,
    name: matnr,
    ...H('A', l2),
    sales,
    qty: {},
    cogs,
  });
  const facts = [mf('a', 'A1', { '202601': 300, '202602': 50 }, { '202601': 200 }), mf('b', 'A2', { '202602': 150 }, {})];
  const jan = buildMonthRows({ ym: '202601', facts, maps: [], inputs: [input('202601', 'A', 30, 0), input('202601', 'Z9', 5, 0)] });
  assert.equal(jan.length, 2); // b는 1월 실적이 없어 빠지고, Z9는 별도 행
  assert.deepEqual(jan[0].amt, { sales: 300, qty: 0, cogs: 200, incentive: 30, general: 0 });
  assert.equal(jan[1].matnr, 'L1:Z9');
  const feb = buildMonthRows({ ym: '202602', facts, maps: [], inputs: [input('202602', 'A', 20, 0)] });
  assert.deepEqual(
    feb.map((r) => r.amt.incentive),
    [5, 15],
  ); // 50:150
});

test('월별 추이: 축별 합계 = 전체, 브리지 막대 합 = 전체 차이', () => {
  const row = (l1: string, sales: number, cogs: number) => ({
    matnr: l1,
    name: l1,
    ...H(l1, `${l1}1`),
    cm: '',
    category: '',
    owner: '',
    amt: { sales, qty: 0, cogs, incentive: 0, general: 0 },
  });
  const blocks = [
    { ym: '202608', kind: 'actual' as const, filled: 0, l1Total: 3, rows: [row('A', 100, 90), row('B', 50, 60), row('C', 10, 5)] },
    { ym: '202609', kind: 'actual' as const, filled: 0, l1Total: 3, rows: [row('A', 120, 100), row('B', 40, 50), row('C', 10, 9)] },
  ];
  const { total, groups } = aggregateTrend(blocks, 'l1');
  assert.deepEqual(
    groups.map((g) => g.key),
    ['A', 'B', 'C'],
  ); // 매출 큰 순
  assert.equal(total[1].sales, 170);
  const steps = buildBridge(groups, 1, 'gp', 1);
  const last = steps.at(-1)!;
  const gpDiff = (metricValue(total[1], 'gp') ?? 0) - (metricValue(total[0], 'gp') ?? 0);
  assert.equal(last.total, true);
  assert.equal(last.delta, gpDiff); // 11 − 5 = 6 (A +10, B 0, C −4)
  assert.equal(steps.length, 3); // top 1 (A) + 기타 1개(C, B는 0이라 제외) + 전체
  assert.equal(steps[1].label, '기타 1개');
  assert.equal(
    steps.slice(0, -1).reduce((s, x) => s + x.delta, 0),
    last.delta,
  );
  assert.deepEqual(buildBridge(groups, 0, 'sales'), []);
});

test('판매단가: 동일제품 단가 변동과 믹스 효과를 나눈다', () => {
  // x: 단가 10 → 11 (+10%), y: 단가 100 고정. 2월에 비싼 y 비중이 늘어 평균단가는 크게 오른다
  const items = [
    { key: 'A', sales: [1000, 1100], qty: [100, 100] },
    { key: 'A', sales: [1000, 3000], qty: [10, 30] },
    { key: 'A', sales: [0, 500], qty: [0, 5] }, // 신제품: 비교 제외
    { key: 'A', sales: [100, 1000], qty: [10, 10] }, // 단가 10배: 정정 전표로 보고 제외
  ];
  const [jan, feb] = pricePoints(items, 2);
  assert.equal(jan.index, 100);
  // 라스파이레스: (11×100 + 100×10) / (10×100 + 100×10) = 2100/2000
  assert.ok(Math.abs(feb.priceChg! - 0.05) < 1e-12);
  assert.ok(Math.abs(feb.index! - 105) < 1e-9);
  assert.equal(feb.matched, 2);
  const avg0 = 2100 / 120;
  const avg1 = 5600 / 145;
  assert.ok(Math.abs(feb.avgChg! - (avg1 / avg0 - 1)) < 1e-12);
  assert.ok(Math.abs((1 + feb.priceChg!) * (1 + feb.mixChg!) - (1 + feb.avgChg!)) < 1e-12);
  assert.ok(Math.abs(feb.coverage! - 4100 / 5600) < 1e-12);
});

test('제품라인별 CM·PM 이름: 이름이 있으면 덮고, 비면 시트 값 유지', () => {
  const base = { name: '', cm1: '', cm2: '○', cm3: '', etc: '', owner: '시트담당' };
  const maps = [
    { ...base, matnr: 'A', category: '즉석밥' },
    { ...base, matnr: 'B', category: '라면' },
    { ...base, matnr: 'C', category: '' },
  ];
  const lines = [
    { line: '즉석밥', cm: '홍CM', pm: '김PM', updatedAt: '', updatedBy: '' },
    { line: '라면', cm: '', pm: '', updatedAt: '', updatedBy: '' },
  ];
  const [a, b, c] = applyLineOwners(maps, lines);
  assert.equal(a.cmName, '홍CM');
  assert.equal(a.owner, '김PM');
  assert.equal(b.cmName, undefined);
  assert.equal(b.owner, '시트담당');
  assert.equal(cmOf(b), 'CM2');
  assert.equal(c.owner, '시트담당');
  // 손익 행의 CM 축은 이름, 이름이 없으면 시트 표시
  const fact = { matnr: 'A', name: 'a', l1: '1', l1t: '1', l2: '2', l2t: '2', l3: '3', l3t: '3', l4: '4', l4t: '4', curSales: 1, curQty: 1, prevSales: 0, prevQty: 0, prevCogs: 0, costQty: 0, costSales: 0, costCogs: 0 };
  const rows = buildRows({ facts: [fact, { ...fact, matnr: 'B' }], maps: [a, b], curInputs: [], prevInputs: [], elapsed: 1, daysInMonth: 30 });
  assert.deepEqual(rows.map((r) => [r.cm, r.owner]), [['홍CM', '김PM'], ['CM2', '시트담당']]);
});

test('고객그룹3 장려금: 채널 안 제품 매출 비중 배부, 매출 없는 채널은 보관 행, 그 달 LV1 장려금 제외', () => {
  const ci = (ch: string, incentive: number, ym = '202610') => ({ ym, ch, cht: `채널${ch}`, incentive, updatedAt: '', updatedBy: '' });
  const sales = [
    { matnr: 'A', ch: 'E', sales: 300 },
    { matnr: 'B', ch: 'E', sales: 100 },
    { matnr: 'B', ch: 'C', sales: 50 },
    { matnr: 'A', ch: 'C', sales: -10 }, // 반품은 비중에서 뺀다
  ];
  const sp = spreadChannel([ci('E', 1000), ci('C', 200), ci('Z', 70), ci('E', 0)], sales);
  assert.equal(sp.byMatnr.get('A'), 750);
  assert.equal(sp.byMatnr.get('B'), 250 + 200);
  assert.deepEqual(sp.orphans.map((o) => o.ch), ['Z']);

  const lv1 = [
    { ym: '202610', l1: '010', l1t: 'x', incentive: 999, general: 50, updatedAt: '', updatedBy: '' },
    { ym: '202609', l1: '010', l1t: 'x', incentive: 999, general: 50, updatedAt: '', updatedBy: '' },
  ];
  assert.deepEqual(lv1InputsFor(lv1, [ci('E', 1000)], '202610').map((i) => [i.incentive, i.general]), [[0, 50]]);
  assert.deepEqual(lv1InputsFor(lv1, [ci('E', 1000)], '202609').map((i) => [i.incentive, i.general]), [[999, 50]]);

  const fact = { matnr: 'A', name: 'a', l1: '010', l1t: 'x', l2: '2', l2t: '2', l3: '3', l3t: '3', l4: '4', l4t: '4', curSales: 400, curQty: 1, prevSales: 0, prevQty: 0, prevCogs: 0, costQty: 0, costSales: 0, costCogs: 0 };
  const rows = buildRows({
    facts: [fact, { ...fact, matnr: 'B', curSales: 200 }],
    maps: [],
    curInputs: lv1InputsFor(lv1, [ci('E', 1000)], '202610'),
    prevInputs: [],
    elapsed: 15,
    daysInMonth: 30,
    curChannel: sp,
  });
  const inc = rows.reduce((s, r) => s + r.fcst.incentive, 0);
  assert.equal(inc, 1270); // 채널 입력 합계 그대로 (LV1 999 제외)
  assert.equal(rows.reduce((s, r) => s + r.fcst.general, 0), 50);
  const keep = rows.find((r) => r.matnr === 'CH:Z');
  assert.equal(keep?.fcst.incentive, 70);
  assert.equal(keep?.mtd.incentive, 35); // 누계 = × 진행률
  assert.equal(keep?.name, ORPHAN_NAME);

  const month = buildMonthRows({
    ym: '202609',
    facts: [{ matnr: 'A', name: 'a', l1: '010', l1t: 'x', l2: '2', l2t: '2', l3: '3', l3t: '3', l4: '4', l4t: '4', sales: { '202609': 10 }, qty: {}, cogs: {} }],
    maps: [],
    inputs: [],
    channel: spreadChannel([ci('E', 500, '202609')], [{ matnr: 'A', ch: 'E', sales: 10 }]),
  });
  assert.equal(month.find((r) => r.matnr === 'A')?.amt.incentive, 500);
});

test('CM 화면 순서: CM1·CM2·CM3 → 이름 → (미매핑) → 기타', () => {
  const labels = ['기타', '(미매핑)', 'CM3', '홍길동', 'CM1', 'CM2'];
  assert.deepEqual([...labels].sort((a, b) => cmRank(a) - cmRank(b)), ['CM1', 'CM2', 'CM3', '홍길동', '(미매핑)', '기타']);
});
