// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate,
  applyLineOwners,
  buildMonthRows,
  buildRows,
  byProduct,
  cmOf,
  estimateCogs,
  costRates,
  forecastFactor,
  groupBy,
  metrics,
  ORPHAN_NAME,
  priceChange,
  sortGroups,
  totalOf,
  unitPrice,
} from '../lib/pnl.ts';
import { getPeriods, progressOf, shiftYm, ymRange } from '../lib/period.ts';
import { pricePoints } from '../lib/price.ts';
import { aggregateTrend, buildBridge, metricValue } from '../lib/trend.ts';
import type { ChannelFact, ChannelInput, Hierarchy, MaterialFact, ProductMap } from '../lib/types.ts';

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

const cf = (matnr: string, ch: string, sales: number, qty = 0, cogs = 0): ChannelFact => ({ matnr, ch, cht: `채널${ch}`, sales, qty, cogs });
const ci = (ym: string, ch: string, incentive: number, general: number, rate = 0): ChannelInput => ({
  ym,
  ch,
  cht: `채널${ch}`,
  incentive,
  general,
  rate,
  updatedAt: '',
  updatedBy: '',
});
const pm = (matnr: string, o: Partial<ProductMap> = {}): ProductMap => ({ matnr, name: matnr, cm1: '', cm2: '', cm3: '', etc: '', category: '', owner: '', ...o });

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

test('손익 구조: 순매출 = 총매출 − 장려금, GP = 순매출 − 원가, OP = GP − 일반비, 이익률은 순매출 대비', () => {
  const m = metrics({ sales: 1000, qty: 10, cogs: 600, incentive: 200, general: 50 });
  assert.equal(m.net, 800);
  assert.equal(m.gp, 200);
  assert.equal(m.op, 150);
  assert.equal(m.gpm, 0.25);
  assert.equal(m.opm, 0.1875);
});

test('buildRows: 제품 × 채널 행, 채널 비용은 채널 안 제품 총매출 비중으로 배부, 예상·진행률·합계 보존', () => {
  const facts = [
    fact({ matnr: 'a', ...H('A', 'A1'), costQty: 10, costCogs: 500, costSales: 1000 }),
    fact({ matnr: 'b', ...H('A', 'A2'), costQty: 10, costCogs: 500, costSales: 1000 }),
  ];
  const rows = buildRows({
    facts,
    cur: [cf('a', 'E', 300, 3), cf('a', 'C', 100, 1), cf('b', 'E', 100, 1)],
    prev: [cf('a', 'E', 900, 9, 400), cf('b', 'E', 100, 1, 50)],
    maps: [pm('a', { cm2: '○', owner: '홍길동' })],
    reps: new Map([['E', '김영업']]),
    curInputs: [ci('202610', 'E', 40, 20), ci('202610', 'Z', 7, 3)],
    prevInputs: [ci('202609', 'E', 50, 10)],
    elapsed: 10,
    daysInMonth: 31,
  });
  const t = totalOf(rows);
  assert.ok(Math.abs(t.fcst.sales - 500 * 3.1) < 1e-9);
  assert.ok(Math.abs(t.fcst.incentive - 47) < 1e-9); // 매출 없는 채널(Z)도 합계에 남는다
  assert.ok(Math.abs(t.mtd.general - 23 * (10 / 31)) < 1e-9);
  assert.equal(t.prev.incentive, 50);
  const aE = rows.find((r) => r.matnr === 'a' && r.ch === 'E')!;
  const aC = rows.find((r) => r.matnr === 'a' && r.ch === 'C')!;
  assert.equal(aE.fcst.incentive, 30); // 채널 E 안에서 300/(300+100) × 40
  assert.equal(aC.fcst.incentive, 0); // 다른 채널에는 배부 안 됨
  assert.equal(aE.prev.incentive, 45); // 900/1000 × 50
  assert.equal(aE.mtd.cogs, 150); // 단위원가 50 × 채널 수량 3
  assert.equal(aE.prev.cogs, 400);
  assert.equal(aE.rep, '김영업');
  assert.equal(aC.rep, '(미매핑)');
  assert.equal(aE.cm, 'CM2');
  assert.equal(aE.cmMark, 'CM2');
  assert.equal(aE.owner, '홍길동');
  assert.ok(Math.abs(aE.fcst.qty - 9.3) < 1e-9);
  assert.equal(unitPrice(aE.mtd), 100);
  assert.equal(unitPrice({ sales: 100, qty: 0 }), null);
  const keep = rows.find((r) => r.matnr === 'CH:Z')!;
  assert.equal(keep.name, ORPHAN_NAME);
  assert.ok(Math.abs(keep.mtd.incentive - 7 * (10 / 31)) < 1e-9);
  // 어느 축으로 묶어도 채널 입력 합계 보존
  for (const axis of ['ch', 'cm', 'name'] as const) {
    assert.ok(Math.abs(groupBy(rows, axis).reduce((s, g) => s + g.fcst.incentive, 0) - 47) < 1e-9);
  }
  // 제품 단위로 합치면 채널 행이 하나로
  const prod = byProduct(rows.filter((r) => r.name !== ORPHAN_NAME));
  assert.equal(prod.length, 2);
  assert.ok(Math.abs(prod.find((r) => r.matnr === 'a')!.mtd.sales - 400) < 1e-9);
  const m = metrics(t.prev);
  assert.equal(m.net, 1000 - 50);
  assert.equal(m.gp, 950 - 450);
  assert.equal(m.op, 500 - 10);
});

test('일반비 변동비: 채널 변동비율(%) × 각 행 총매출 (누계·예상·전월 각각), 고정비와 합산', () => {
  const facts = [fact({ matnr: 'a', costQty: 10, costCogs: 500, costSales: 1000 }), fact({ matnr: 'b', costQty: 10, costCogs: 500, costSales: 1000 })];
  const rows = buildRows({
    facts,
    cur: [cf('a', 'E', 300, 3), cf('b', 'E', 100, 1), cf('a', 'C', 200, 2)],
    prev: [cf('a', 'E', 1000, 10, 400)],
    maps: [],
    reps: new Map(),
    curInputs: [ci('202610', 'E', 0, 40, 2.5)], // 고정비 40 + 변동비 2.5%
    prevInputs: [ci('202609', 'E', 0, 0, 10)],
    elapsed: 10,
    daysInMonth: 31,
  });
  const aE = rows.find((r) => r.matnr === 'a' && r.ch === 'E')!;
  const aC = rows.find((r) => r.matnr === 'a' && r.ch === 'C')!;
  assert.ok(Math.abs(aE.fcst.general - (30 + 300 * 3.1 * 0.025)) < 1e-9); // 고정비 300/400 × 40 + 예상 매출 × 2.5%
  assert.ok(Math.abs(aE.mtd.general - (30 * (10 / 31) + 300 * 0.025)) < 1e-9); // 누계: 고정비 × 진행률 + 누계 매출 × 2.5%
  assert.equal(aE.prev.general, 100); // 전월 매출 1000 × 10%
  assert.equal(aC.fcst.general, 0); // 다른 채널은 영향 없음
  const t = totalOf(rows);
  assert.ok(Math.abs(t.fcst.general - (40 + 400 * 3.1 * 0.025)) < 1e-9);
  // 마감월도 같은 방식
  const month = buildMonthRows({ facts: [cf('a', 'E', 200, 2, 100)], dims: new Map(), maps: [], reps: new Map(), inputs: [ci('202608', 'E', 0, 10, 5)] });
  assert.equal(month[0].amt.general, 10 + 200 * 0.05);
});

test('마감월: 제품 × 채널 실적 + 그 달 채널 입력 배부, 매출 없는 채널은 보관 행', () => {
  const dims = new Map([['a', { matnr: 'a', name: '에이', ...H('A', 'A1') }]]);
  const rows = buildMonthRows({
    facts: [cf('a', 'E', 50, 1, 30), cf('b', 'E', 150, 3, 90), cf('a', 'C', 10, 1, 5)],
    dims,
    maps: [],
    reps: new Map(),
    inputs: [ci('202602', 'E', 20, 4), ci('202602', 'Q', 5, 0)],
  });
  assert.deepEqual(
    rows.filter((r) => r.ch === 'E').map((r) => [r.matnr, r.amt.incentive, r.amt.general]),
    [['a', 5, 1], ['b', 15, 3]],
  );
  assert.equal(rows.find((r) => r.matnr === 'a')!.name, '에이');
  assert.equal(rows.find((r) => r.matnr === 'b')!.l1t, '(미분류)'); // 계층 정보가 없는 제품
  assert.equal(rows.find((r) => r.matnr === 'CH:Q')!.amt.incentive, 5);
});

test('동일제품 단가 변동률: 전월 수량 고정, 0.2~5배 밖·한쪽만 있는 제품 제외', () => {
  const r = (matnr: string, cur: [number, number], prev: [number, number]) => ({
    matnr,
    mtd: { sales: cur[0], qty: cur[1], cogs: 0, incentive: 0, general: 0 },
    fcst: { sales: cur[0], qty: cur[1], cogs: 0, incentive: 0, general: 0 },
    prev: { sales: prev[0], qty: prev[1], cogs: 0, incentive: 0, general: 0 },
  });
  const rows = [r('x', [1100, 100], [1000, 100]), r('y', [3000, 30], [1000, 10]), r('n', [500, 5], [0, 0]), r('z', [1000, 10], [100, 10])];
  // (11×100 + 100×10) / (10×100 + 100×10) − 1 = 5%
  assert.ok(Math.abs(priceChange(rows, 'fcst')! - 0.05) < 1e-12);
  assert.equal(priceChange(rows, 'prev'), null);
  // 같은 제품이 채널로 나뉘어 있어도 제품 단위로 합쳐 비교
  const split = [r('x', [550, 50], [500, 50]), r('x', [550, 50], [500, 50])];
  assert.ok(Math.abs(priceChange(split, 'mtd')! - 0.1) < 1e-12);
});

test('월별 추이: 축별 합계 = 전체, 브리지 막대 합 = 전체 차이', () => {
  const row = (l1: string, sales: number, cogs: number) => ({
    matnr: l1,
    name: l1,
    ...H(l1, `${l1}1`),
    cm: '',
    cmMark: '',
    category: '',
    owner: '',
    ch: 'E',
    cht: 'E',
    rep: '',
    amt: { sales, qty: 0, cogs, incentive: 0, general: 0 },
  });
  const blocks = [
    { ym: '202608', kind: 'actual' as const, filled: 0, chTotal: 1, rows: [row('A', 100, 90), row('B', 50, 60), row('C', 10, 5)] },
    { ym: '202609', kind: 'actual' as const, filled: 0, chTotal: 1, rows: [row('A', 120, 100), row('B', 40, 50), row('C', 10, 9)] },
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

test('CM·PM: CM은 시트 CM1~CM3 표시 그대로, PM은 시트 담당자 → 비었을 때만 제품라인 PM명', () => {
  const maps = [
    pm('A', { cm2: '○', owner: '시트담당', category: '즉석밥' }),
    pm('B', { cm2: '○', owner: '', category: '즉석밥' }),
    pm('C', { cm3: '○' }),
  ];
  const lines = [{ line: '즉석밥', cm: '홍CM', pm: '김PM', updatedAt: '', updatedBy: '' }];
  const [a, b, c] = applyLineOwners(maps, lines);
  assert.equal(a.owner, '시트담당'); // 시트 담당자가 기준
  assert.equal(b.owner, '김PM'); // 담당자가 비면 제품라인 PM명
  assert.equal(c.owner, '');
  const rows = buildRows({
    facts: [fact({ matnr: 'A' }), fact({ matnr: 'C' })],
    cur: [cf('A', 'E', 10), cf('C', 'E', 5)],
    prev: [],
    maps: [a, c],
    reps: new Map(),
    curInputs: [],
    prevInputs: [],
    elapsed: 1,
    daysInMonth: 30,
  });
  assert.deepEqual(rows.map((r) => [r.cm, r.owner]), [['CM2', '시트담당'], ['CM3', '(미매핑)']]); // 제품라인 CM명(홍CM)은 쓰지 않는다
});

test('CM 화면 순서: 이름으로 바뀌어도 CM1 → CM2 → CM3 → (미매핑) → 기타, 같은 CM 안은 매출순', () => {
  const g = (label: string, mark: string, sales: number) => ({ label, sales, rows: [{ cmMark: mark }] });
  // '기타'라는 이름을 CM1 표시 제품라인에 붙여도 기타 자리 (이름이 CM 표시 자체면 이름 기준)
  const sorted = sortGroups([g('기타', 'CM1', 9), g('(미매핑)', '(미매핑)', 8), g('김면', 'CM3', 7), g('CM3', 'CM3', 2), g('최냉동', 'CM1', 1), g('이밥', 'CM2', 5), g('김HMI', 'CM2', 6)], 'cm', (x) => x.sales);
  assert.deepEqual(sorted.map((x) => x.label), ['최냉동', '김HMI', '이밥', '김면', 'CM3', '(미매핑)', '기타']);
  // 이름 묶음에 CM 표시가 섞이면 가장 많은 표시를 따른다
  const mixed = { label: '김HMI', sales: 1, rows: [{ cmMark: 'CM1' }, { cmMark: 'CM2' }, { cmMark: 'CM2' }] };
  assert.deepEqual(sortGroups([mixed, g('최냉동', 'CM1', 0)], 'cm', (x) => x.sales).map((x) => x.label), ['최냉동', '김HMI']);
  const bySales = sortGroups([g('a', 'CM3', 1), g('b', 'CM1', 2)], 'name', (x) => x.sales);
  assert.deepEqual(bySales.map((x) => x.label), ['b', 'a']);
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
