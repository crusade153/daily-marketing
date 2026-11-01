// 손익 순수 계산. BigQuery 제품 × 고객그룹3(채널) 실적 + 수기 입력(장려금·일반비) → 시나리오별 손익 행.
//   순매출 = 총매출 − 장려금
//   매출총이익(GP) = 순매출 − 매출원가
//   영업이익(OP) = GP − 일반비.   GP율·OP율의 분모는 순매출 (2026-10-30 사용자 결정)
//   당월 매출원가 = 당월 수량 × 최근 3개월 평균 단위원가 (이력이 없으면 LV2 → LV1 → 전사 원가율 × 매출)
//   당월 예상 = 당월 누계 ÷ 진행일 × 월 일수
//   장려금·일반비(고정비) 입력값 = 고객그룹3(채널)의 월 전체 금액. 예상에는 그대로, 누계에는 × 진행률.
//     채널 안에서는 제품 총매출 비중으로 배분 → CM·PM·제품라인·제품 등 어느 축으로 묶어도 합계가 같다.
//   일반비(변동비) = 채널 변동비율(%) × 각 행 총매출 (누계·예상·전월 각각의 매출). 일반비 = 고정비 + 변동비
//   마감월(올해 1월 ~ 전월) = CO-PA 실적 매출·실제원가 + 그 달 채널 입력값
import type {
  Amounts,
  ChannelFact,
  ChannelInput,
  CostMethod,
  Hierarchy,
  LineOwner,
  MaterialFact,
  MaterialHist,
  MaterialRow,
  MonthRow,
  ProductMap,
  RowDims,
  Scenario,
} from './types';

export const ZERO: Amounts = { sales: 0, qty: 0, cogs: 0, incentive: 0, general: 0 };

export function addAmounts(a: Amounts, b: Amounts): Amounts {
  return {
    sales: a.sales + b.sales,
    qty: a.qty + b.qty,
    cogs: a.cogs + b.cogs,
    incentive: a.incentive + b.incentive,
    general: a.general + b.general,
  };
}

export function scaleAmounts(a: Amounts, k: number): Amounts {
  return {
    sales: a.sales * k,
    qty: a.qty * k,
    cogs: a.cogs * k,
    incentive: a.incentive * k,
    general: a.general * k,
  };
}

export interface Metrics extends Amounts {
  net: number; // 순매출 = 총매출 − 장려금
  gp: number; // 매출총이익 = 순매출 − 매출원가
  gpm: number | null; // GP율 (순매출 대비)
  op: number; // 영업이익 = GP − 일반비
  opm: number | null; // OP율 (순매출 대비)
}

export function metrics(a: Amounts): Metrics {
  const net = a.sales - a.incentive;
  const gp = net - a.cogs;
  const op = gp - a.general;
  return {
    ...a,
    net,
    gp,
    gpm: net ? gp / net : null,
    op,
    opm: net ? op / net : null,
  };
}

/** 판매단가(원/EA). 수량·매출이 양수일 때만 — 제품 단위에서만 의미가 있다 */
export const unitPrice = (a: Pick<Amounts, 'sales' | 'qty'>) => (a.qty > 0 && a.sales > 0 ? a.sales / a.qty : null);

/** 동일제품 비교에서 뺄 단가 비율 (단위·정정 전표로 본다) — lib/price.ts와 같은 기준 */
const PRICE_RATIO_MIN = 0.2;
const PRICE_RATIO_MAX = 5;

/**
 * 동일제품 단가 변동률 (전월 수량 고정, 라스파이레스). 묶음의 평균단가는 제품 구성에 따라 흔들리므로
 * 같은 제품끼리 전월 대비 단가만 비교한다. 비교할 제품이 없으면 null
 */
export function priceChange(rows: Pick<MaterialRow, 'matnr' | 'mtd' | 'fcst' | 'prev'>[], s: Scenario): number | null {
  if (s === 'prev') return null;
  const by = new Map<string, { cs: number; cq: number; ps: number; pq: number }>();
  for (const r of rows) {
    const v = by.get(r.matnr) ?? { cs: 0, cq: 0, ps: 0, pq: 0 };
    v.cs += r[s].sales;
    v.cq += r[s].qty;
    v.ps += r.prev.sales;
    v.pq += r.prev.qty;
    by.set(r.matnr, v);
  }
  let num = 0;
  let den = 0;
  for (const v of by.values()) {
    const cur = unitPrice({ sales: v.cs, qty: v.cq });
    const prev = unitPrice({ sales: v.ps, qty: v.pq });
    if (cur == null || prev == null) continue;
    const ratio = cur / prev;
    if (ratio < PRICE_RATIO_MIN || ratio > PRICE_RATIO_MAX) continue;
    num += cur * v.pq;
    den += prev * v.pq;
  }
  return den > 0 ? num / den - 1 : null;
}

/** 예상치 확장 배수. 진행일이 0이면 0 */
export function forecastFactor(elapsed: number, daysInMonth: number): number {
  return elapsed > 0 ? daysInMonth / elapsed : 0;
}

/**
 * 원가 마감 판정: 그 달 CO-PA 실제원가가 매출의 절반 이상 들어왔으면 마감.
 * 마감 전에는 원가가 매출의 1% 안팎, 마감 후 95~110% (2026-04~10 확인)라 경계가 뚜렷하다.
 */
export const COST_CLOSE_RATIO = 0.5;
export const costClosed = (cogs: number, sales: number) => sales > 0 && cogs >= sales * COST_CLOSE_RATIO;

/**
 * 당월 전 4개월 중 원가가 마감된 최근 3개월을 원가 평균 기준으로 삼는다.
 * 전월이 마감 전이면 한 달 앞으로 밀린다 (11월에 10월이 마감 전이면 7~9월).
 * 마감된 달이 하나도 없으면(데이터 이상) 최근 3개월을 그대로 쓴다.
 */
export function applyCostBasis(raws: MaterialHist[], histYms: string[]) {
  const total = (k: 'histSales' | 'histCogs') => histYms.map((_, i) => raws.reduce((s, r) => s + (r[k][i] ?? 0), 0));
  const sales = total('histSales');
  const cogs = total('histCogs');
  const closed = histYms.map((_, i) => costClosed(cogs[i], sales[i]));
  const closedIdx = histYms.map((_, i) => i).filter((i) => closed[i]);
  const idx = (closedIdx.length ? closedIdx : histYms.map((_, i) => i)).slice(-3);
  const pick = (v: number[]) => idx.reduce((s, i) => s + (v[i] ?? 0), 0);
  const facts: MaterialFact[] = raws.map(({ histQty, histSales, histCogs, ...f }) => ({
    ...f,
    costQty: pick(histQty),
    costSales: pick(histSales),
    costCogs: pick(histCogs),
  }));
  const curSales = raws.reduce((s, r) => s + r.curSales, 0);
  const curCogs = raws.reduce((s, r) => s + r.curCogs, 0);
  return {
    facts,
    costYms: idx.map((i) => histYms[i]),
    prevClosed: closed[closed.length - 1] ?? false,
    curClosed: costClosed(curCogs, curSales),
  };
}

type RateTable = { l2: Map<string, number>; l1: Map<string, number>; all: number | null };

/** 원가 기준 3개월 원가율(원가 ÷ 매출) — 단위원가가 없는 품목의 대체용 */
export function costRates(facts: MaterialFact[]): RateTable {
  const acc = (m: Map<string, [number, number]>, k: string, f: MaterialFact) => {
    const v = m.get(k) ?? [0, 0];
    v[0] += f.costCogs;
    v[1] += f.costSales;
    m.set(k, v);
  };
  const l2 = new Map<string, [number, number]>();
  const l1 = new Map<string, [number, number]>();
  let cogs = 0;
  let sales = 0;
  for (const f of facts) {
    acc(l2, f.l2, f);
    acc(l1, f.l1, f);
    cogs += f.costCogs;
    sales += f.costSales;
  }
  const toRate = (m: Map<string, [number, number]>) =>
    new Map([...m].filter(([, [c, s]]) => s > 0 && c > 0).map(([k, [c, s]]) => [k, c / s]));
  return { l2: toRate(l2), l1: toRate(l1), all: sales > 0 ? cogs / sales : null };
}

export function estimateCogs(f: MaterialFact, rates: RateTable): { cogs: number; method: CostMethod } {
  if (f.costQty > 0 && f.costCogs > 0) {
    return { cogs: f.curQty * (f.costCogs / f.costQty), method: 'unit' };
  }
  const rate = rates.l2.get(f.l2) ?? rates.l1.get(f.l1) ?? rates.all;
  if (rate == null) return { cogs: 0, method: 'none' };
  return { cogs: f.curSales * rate, method: 'rate' };
}

/** 제품 × 채널 한 줄의 추정 원가: 원가 기준 3개월 단위원가 × 수량, 이력이 없으면 계층 원가율 × 매출 */
function channelCogs(c: ChannelFact, f: MaterialFact | undefined, rates: RateTable): { cogs: number; method: CostMethod } {
  if (f) return estimateCogs({ ...f, curQty: c.qty, curSales: c.sales }, rates);
  return { cogs: rates.all != null ? c.sales * rates.all : 0, method: rates.all != null ? 'rate' : 'none' };
}

/** 한 달 채널 실적의 원가 결산 여부 (CO-PA 실제원가 합 ÷ 매출 합) */
export function factsClosed(list: ChannelFact[]): boolean {
  let cogs = 0;
  let sales = 0;
  for (const c of list) {
    cogs += c.cogs;
    sales += c.sales;
  }
  return costClosed(cogs, sales);
}

/** 원가 결산 전인 달의 채널 실적: CO-PA 원가(거의 0) 대신 당월 예상과 같은 방식의 추정 원가를 넣는다 */
export function estimateFactsCogs(list: ChannelFact[], facts: MaterialFact[]): ChannelFact[] {
  const factBy = new Map(facts.map((f) => [f.matnr, f]));
  const rates = costRates(facts);
  return list.map((c) => ({ ...c, cogs: channelCogs(c, factBy.get(c.matnr), rates).cogs }));
}

/**
 * 금액을 행 매출 비중으로 배분한다. 양(+)의 매출만 가중치로 쓴다.
 * 가중치 합이 0이면 배분할 행이 없으므로 null — 호출부에서 '(매출 없음)' 행으로 받는다.
 */
export function allocate(total: number, weights: number[]): number[] | null {
  const pos = weights.map((w) => (w > 0 ? w : 0));
  const sum = pos.reduce((s, w) => s + w, 0);
  if (sum <= 0) return null;
  return pos.map((w) => (total * w) / sum);
}

const UNMAPPED = '(미매핑)';
export const CM_DUPLICATE = '(CM 중복)';
export const ORPHAN_NAME = '(매출 없음 · 입력 비용)';

/** 소속이 아님을 뜻하는 표시. 빈칸도 미소속 */
const NOT_MARKED = new Set(['X', 'x', '×', 'N', 'n', '0', '-']);

const CM_COLS = [
  ['cm1', 'CM1'],
  ['cm2', 'CM2'],
  ['cm3', 'CM3'],
  ['etc', '기타'],
] as const;

/**
 * CM 화면 순서: CM1 → CM2 → CM3 → (미매핑) → 기타 → (CM 중복). 사용자 요청.
 * CM 이름으로 바뀐 행도 시트 표시(cmMark)로 순서를 정한다. 같은 순번 안에서는 0 → 호출부의 매출순이 남는다.
 */
const CM_ORDER = ['CM1', 'CM2', 'CM3', UNMAPPED, '기타', CM_DUPLICATE];
export function cmRank(mark: string): number {
  const i = CM_ORDER.indexOf(mark);
  return i < 0 ? CM_ORDER.length : i;
}

/** CM 묶음의 순번: 이름이 CM 표시 자체(CM3·기타 등)면 그 순번, 사람 이름이면 묶인 행에 가장 많은 CM 표시 */
export function cmGroupRank(label: string, marks: string[]): number {
  if (CM_ORDER.includes(label)) return cmRank(label);
  const n = new Map<string, number>();
  for (const m of marks) n.set(m, (n.get(m) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1] || cmRank(a[0]) - cmRank(b[0]))[0];
  return top ? cmRank(top[0]) : CM_ORDER.length;
}

/** 시트 CM1~CM3·기타 열 중 표시가 된 열 이름. 없으면 미매핑, 둘 이상이면 중복 */
export function cmOf(m: ProductMap | undefined): string {
  if (!m) return UNMAPPED;
  const marked = CM_COLS.filter(([k]) => m[k] && !NOT_MARKED.has(m[k]));
  if (marked.length === 0) return UNMAPPED;
  if (marked.length > 1) return CM_DUPLICATE;
  return marked[0][1];
}

/**
 * 제품라인 PM명을 품목 매핑에 입힌다. 분석 화면의 CM은 시트 CM1~CM3 표시 그대로 쓰고(2026-10-30 사용자 요청:
 * 이름까지 나오면 지저분), PM은 시트 담당자 열이 기준 — 담당자가 비어 있을 때만 제품라인 PM명으로 채운다.
 * 제품라인 CM명(line_owner)은 참고용으로 시트에만 남는다.
 */
export function applyLineOwners(maps: ProductMap[], lines: LineOwner[]): ProductMap[] {
  const byLine = new Map(lines.map((l) => [l.line, l]));
  return maps.map((m) => {
    const pm = m.category ? byLine.get(m.category)?.pm : undefined;
    return !m.owner && pm ? { ...m, owner: pm } : m;
  });
}

type ProductDims = Hierarchy & { matnr: string; name: string };

const UNKNOWN_HIER = { l1: '-', l1t: '(미분류)', l2: '-', l2t: '(미분류)', l3: '-', l3t: '(미분류)', l4: '-', l4t: '(미분류)' };

function dimsOf(f: ProductDims, m: ProductMap | undefined, ch: { ch: string; cht: string }, reps: Map<string, string>): RowDims {
  return {
    matnr: f.matnr,
    name: f.name,
    l1: f.l1,
    l1t: f.l1t,
    l2: f.l2,
    l2t: f.l2t,
    l3: f.l3,
    l3t: f.l3t,
    l4: f.l4,
    l4t: f.l4t,
    cm: cmOf(m),
    cmMark: cmOf(m),
    category: m?.category || UNMAPPED,
    owner: m?.owner || UNMAPPED,
    ch: ch.ch,
    cht: ch.cht,
    rep: reps.get(ch.ch) || UNMAPPED,
  };
}

/** 채널 비용 중 그 달 그 채널 매출이 없어 제품에 붙일 수 없는 금액을 담는 행 (채널별 하나) */
function channelOrphanDims(inp: Pick<ChannelInput, 'ch' | 'cht'>, reps: Map<string, string>): RowDims {
  const code = `CH:${inp.ch}`;
  const label = `(채널 비용) ${inp.cht || inp.ch}`;
  return {
    matnr: code,
    name: ORPHAN_NAME,
    l1: code,
    l1t: label,
    l2: code,
    l2t: label,
    l3: code,
    l3t: label,
    l4: code,
    l4t: label,
    cm: UNMAPPED,
    cmMark: UNMAPPED,
    category: UNMAPPED,
    owner: UNMAPPED,
    ch: inp.ch,
    cht: inp.cht || inp.ch,
    rep: reps.get(inp.ch) || UNMAPPED,
  };
}

/**
 * 채널 입력 금액(장려금·일반비 고정비)을 그 채널 행들의 매출 비중으로 나눠 add로 넘긴다.
 * 매출이 없는 채널은 extra의 채널별 보관 행으로. 변동비율은 채널의 모든 행에 addRate(행, 비율)로 넘긴다.
 */
function spreadChannelInputs<R extends RowDims>(
  rows: R[],
  inputs: ChannelInput[],
  weight: (r: R) => number,
  add: (r: R, incentive: number, general: number) => void,
  addRate: (r: R, rate: number) => void,
  extra: Map<string, R>,
  make: (d: RowDims) => R,
  reps: Map<string, string>,
) {
  const byCh = new Map<string, R[]>();
  for (const r of rows) {
    const list = byCh.get(r.ch);
    if (list) list.push(r);
    else byCh.set(r.ch, [r]);
  }
  for (const inp of inputs) {
    const list = byCh.get(inp.ch) ?? [];
    if (inp.rate) for (const r of list) addRate(r, inp.rate / 100);
    if (!inp.incentive && !inp.general) continue;
    const w = list.map(weight);
    const inc = allocate(inp.incentive, w);
    const gen = allocate(inp.general, w);
    if (inc && gen) {
      list.forEach((r, j) => add(r, inc[j], gen[j]));
      continue;
    }
    const d = channelOrphanDims(inp, reps);
    let r = extra.get(d.matnr);
    if (!r) {
      r = make(d);
      extra.set(d.matnr, r);
    }
    add(r, inp.incentive, inp.general);
  }
}

const rowKey = (matnr: string, ch: string) => `${matnr}|${ch}`;

export function buildRows(params: {
  /** 제품 단위: 계층·3개월 원가 이력 */
  facts: MaterialFact[];
  /** 제품 × 채널: 당월 누계, 전월 실적 */
  cur: ChannelFact[];
  prev: ChannelFact[];
  maps: ProductMap[];
  reps: Map<string, string>;
  curInputs: ChannelInput[];
  prevInputs: ChannelInput[];
  elapsed: number;
  daysInMonth: number;
}): MaterialRow[] {
  const { facts, cur, prev, maps, reps, curInputs, prevInputs, elapsed, daysInMonth } = params;
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  const factBy = new Map(facts.map((f) => [f.matnr, f]));
  const rates = costRates(facts);
  const k = forecastFactor(elapsed, daysInMonth);
  const progress = daysInMonth ? elapsed / daysInMonth : 0;

  const byKey = new Map<string, MaterialRow>();
  const at = (c: ChannelFact): MaterialRow => {
    const key = rowKey(c.matnr, c.ch);
    let r = byKey.get(key);
    if (!r) {
      const f = factBy.get(c.matnr);
      const dims = f ?? { matnr: c.matnr, name: c.matnr, ...UNKNOWN_HIER };
      r = { ...dimsOf(dims, mapBy.get(c.matnr), c, reps), costMethod: 'none', mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } };
      byKey.set(key, r);
    }
    return r;
  };
  for (const c of cur) {
    const r = at(c);
    const est = channelCogs(c, factBy.get(c.matnr), rates);
    r.costMethod = est.method;
    r.mtd = { ...ZERO, sales: c.sales, qty: c.qty, cogs: est.cogs };
    r.fcst = scaleAmounts(r.mtd, k);
  }
  for (const c of prev) {
    const r = at(c);
    r.prev = { ...ZERO, sales: c.sales, qty: c.qty, cogs: c.cogs };
    if (r.costMethod === 'none' && !r.mtd.sales) r.costMethod = 'unit'; // 전월만 있는 행은 실제원가
  }
  const rows = [...byKey.values()];

  const extra = new Map<string, MaterialRow>();
  const make = (d: RowDims): MaterialRow => ({ ...d, costMethod: 'unit', mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } });
  spreadChannelInputs(
    rows,
    curInputs,
    (r) => r.mtd.sales,
    (r, inc, gen) => {
      r.fcst.incentive += inc;
      r.fcst.general += gen;
      r.mtd.incentive += inc * progress;
      r.mtd.general += gen * progress;
    },
    (r, rate) => {
      r.fcst.general += r.fcst.sales * rate;
      r.mtd.general += r.mtd.sales * rate;
    },
    extra,
    make,
    reps,
  );
  spreadChannelInputs(
    rows,
    prevInputs,
    (r) => r.prev.sales,
    (r, inc, gen) => {
      r.prev.incentive += inc;
      r.prev.general += gen;
    },
    (r, rate) => {
      r.prev.general += r.prev.sales * rate;
    },
    extra,
    make,
    reps,
  );
  return [...rows, ...extra.values()];
}

/** 마감월 한 달의 손익 행. 매출·원가는 CO-PA 실적, 장려금·일반비는 그 달 채널 입력값을 채널 안 매출 비중으로 배분. */
export function buildMonthRows(params: {
  facts: ChannelFact[];
  dims: Map<string, ProductDims>;
  maps: ProductMap[];
  reps: Map<string, string>;
  inputs: ChannelInput[];
}): MonthRow[] {
  const { facts, dims, maps, reps, inputs } = params;
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  const rows: MonthRow[] = facts
    .filter((f) => f.sales || f.cogs || f.qty)
    .map((f) => ({
      ...dimsOf(dims.get(f.matnr) ?? { matnr: f.matnr, name: f.matnr, ...UNKNOWN_HIER }, mapBy.get(f.matnr), f, reps),
      amt: { ...ZERO, sales: f.sales, qty: f.qty, cogs: f.cogs },
    }));
  const extra = new Map<string, MonthRow>();
  spreadChannelInputs(
    rows,
    inputs,
    (r) => r.amt.sales,
    (r, inc, gen) => {
      r.amt.incentive += inc;
      r.amt.general += gen;
    },
    (r, rate) => {
      r.amt.general += r.amt.sales * rate;
    },
    extra,
    (d) => ({ ...d, amt: { ...ZERO } }),
    reps,
  );
  return [...rows, ...extra.values()];
}

/** 제품 단위로 합친다 (채널 행 → 제품 한 행). 축 값은 첫 행, 채널은 '전체' */
export function byProduct(rows: MaterialRow[]): MaterialRow[] {
  const map = new Map<string, MaterialRow>();
  for (const r of rows) {
    const p = map.get(r.matnr);
    if (!p) {
      map.set(r.matnr, { ...r, ch: '*', cht: '전체', rep: '-', mtd: { ...r.mtd }, fcst: { ...r.fcst }, prev: { ...r.prev } });
      continue;
    }
    p.mtd = addAmounts(p.mtd, r.mtd);
    p.fcst = addAmounts(p.fcst, r.fcst);
    p.prev = addAmounts(p.prev, r.prev);
    if (p.costMethod === 'unit' && r.costMethod !== 'unit') p.costMethod = r.costMethod;
  }
  return [...map.values()];
}

/** 분석 축. 제품계층은 코드로 묶고 이름으로 보여준다 (이름이 같은 다른 계층이 섞이지 않도록) */
export type Axis = 'l1' | 'l2' | 'l3' | 'l4' | 'cm' | 'category' | 'owner' | 'name' | 'ch' | 'rep';

export const AXIS_LABEL: Record<Axis, string> = {
  l1: '브랜드',
  l2: '제품계층 LV2',
  l3: '제품계층 LV3',
  l4: '제품계층 LV4',
  cm: 'CM',
  category: '제품라인',
  owner: 'PM',
  name: '제품',
  ch: '채널',
  rep: '영업담당자',
};

export function axisKey(r: RowDims, axis: Axis): string {
  return axis === 'name' ? r.matnr : r[axis];
}

export function axisLabel(r: RowDims, axis: Axis): string {
  switch (axis) {
    case 'name':
      return r.name;
    case 'l1':
      return r.l1t;
    case 'l2':
      return r.l2t;
    case 'l3':
      return r.l3t;
    case 'l4':
      return r.l4t;
    case 'ch':
      return r.cht;
    default:
      return r[axis];
  }
}

export interface Group {
  key: string;
  label: string;
  mtd: Amounts;
  fcst: Amounts;
  prev: Amounts;
  rows: MaterialRow[];
}

export function groupBy(rows: MaterialRow[], axis: Axis): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = axisKey(r, axis);
    const g = map.get(key) ?? {
      key,
      label: axisLabel(r, axis),
      mtd: { ...ZERO },
      fcst: { ...ZERO },
      prev: { ...ZERO },
      rows: [],
    };
    g.mtd = addAmounts(g.mtd, r.mtd);
    g.fcst = addAmounts(g.fcst, r.fcst);
    g.prev = addAmounts(g.prev, r.prev);
    g.rows.push(r);
    map.set(key, g);
  }
  return [...map.values()];
}

/** 화면 정렬: CM 축은 CM1·CM2·CM3·(미매핑)·기타 순, 그 안과 다른 축은 매출 큰 순 */
export function sortGroups<G extends { label: string; rows: { cmMark: string }[] }>(groups: G[], axis: Axis, sales: (g: G) => number): G[] {
  const ranks = new Map(groups.map((g) => [g, axis === 'cm' ? cmGroupRank(g.label, g.rows.map((r) => r.cmMark)) : 0]));
  const rank = (g: G) => ranks.get(g) ?? 0;
  return groups.sort((a, b) => rank(a) - rank(b) || sales(b) - sales(a));
}

export function totalOf(rows: MaterialRow[]): { mtd: Amounts; fcst: Amounts; prev: Amounts } {
  return rows.reduce(
    (t, r) => ({ mtd: addAmounts(t.mtd, r.mtd), fcst: addAmounts(t.fcst, r.fcst), prev: addAmounts(t.prev, r.prev) }),
    { mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } },
  );
}
