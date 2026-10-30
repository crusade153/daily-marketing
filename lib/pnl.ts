// 손익 순수 계산. BigQuery 품목 집계 + 수기 입력(장려금·일반비) → 시나리오별 품목 손익 행.
//   매출이익 = 매출 − 매출원가
//   영업이익 = 매출이익 − 장려금 − 일반비
//   당월 매출원가 = 당월 수량 × 최근 3개월 평균 단위원가 (이력이 없으면 LV2 → LV1 → 전사 원가율 × 매출)
//   당월 예상 = 당월 누계 ÷ 진행일 × 월 일수
//   장려금·일반비 입력값 = 제품계층 LV1의 월 전체 금액. 예상에는 그대로, 누계에는 × 진행률.
//     LV1 안에서는 품목 매출 비중으로 배분 → LV2~LV4·CM·담당자 등 어느 축으로 묶어도 합계가 같다.
//   마감월(올해 1월 ~ 전월) = CO-PA 실적 매출·실제원가 + 그 달 입력값
import type {
  Amounts,
  ChannelInput,
  ChannelSale,
  CostMethod,
  Hierarchy,
  LineOwner,
  ManualInput,
  MaterialFact,
  MaterialRow,
  MonthFact,
  MonthRow,
  ProductMap,
  RowDims,
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
  gp: number; // 매출이익
  gpm: number | null; // 매출이익률
  op: number; // 영업이익
  opm: number | null; // 영업이익률
}

export function metrics(a: Amounts): Metrics {
  const gp = a.sales - a.cogs;
  const op = gp - a.incentive - a.general;
  return {
    ...a,
    gp,
    gpm: a.sales ? gp / a.sales : null,
    op,
    opm: a.sales ? op / a.sales : null,
  };
}

/** 판매단가(원/EA). 수량·매출이 양수일 때만 — 제품 단위에서만 의미가 있다 */
export const unitPrice = (a: Pick<Amounts, 'sales' | 'qty'>) => (a.qty > 0 && a.sales > 0 ? a.sales / a.qty : null);

/** 예상치 확장 배수. 진행일이 0이면 0 */
export function forecastFactor(elapsed: number, daysInMonth: number): number {
  return elapsed > 0 ? daysInMonth / elapsed : 0;
}

type RateTable = { l2: Map<string, number>; l1: Map<string, number>; all: number | null };

/** 3개월 원가율(원가 ÷ 매출) — 단위원가가 없는 품목의 대체용 */
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

/**
 * LV1 금액을 품목 매출 비중으로 배분한다. 양(+)의 매출만 가중치로 쓴다.
 * 가중치 합이 0이면 배분할 품목이 없으므로 null — 호출부에서 '(매출 없음)' 행으로 받는다.
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
 * CM 축 화면 순서: CM1 → CM2 → CM3 → (CM 이름으로 바꾼 값) → (미매핑) → 기타 → (CM 중복). 사용자 요청.
 * 같은 순번 안에서는 0을 돌려주므로 호출하는 쪽의 매출순 정렬이 그대로 남는다.
 */
const CM_ORDER = ['CM1', 'CM2', 'CM3', '', UNMAPPED, '기타', CM_DUPLICATE];
export function cmRank(label: string): number {
  const i = CM_ORDER.indexOf(label);
  return i < 0 ? CM_ORDER.indexOf('') : i;
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
 * 제품라인별 CM·PM 이름을 품목 매핑에 입힌다. 이름이 비어 있으면 원래 값(CM1~CM3 표시, 시트 담당자)을 쓴다.
 * 제품라인이 없는 품목은 그대로.
 */
export function applyLineOwners(maps: ProductMap[], lines: LineOwner[]): ProductMap[] {
  const byLine = new Map(lines.map((l) => [l.line, l]));
  return maps.map((m) => {
    const l = m.category ? byLine.get(m.category) : undefined;
    if (!l || (!l.cm && !l.pm)) return m;
    return { ...m, cmName: l.cm || undefined, owner: l.pm || m.owner };
  });
}

function dimsOf(f: Hierarchy & { matnr: string; name: string }, m: ProductMap | undefined): RowDims {
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
    cm: m?.cmName || cmOf(m),
    category: m?.category || UNMAPPED,
    owner: m?.owner || UNMAPPED,
  };
}

/** LV1에 매출 품목이 없을 때 입력 비용을 담는 행 */
function orphanDims(inp: ManualInput): RowDims {
  const code = `${inp.l1}:INPUT`;
  return {
    matnr: `L1:${inp.l1}`,
    name: ORPHAN_NAME,
    l1: inp.l1,
    l1t: inp.l1t || inp.l1,
    l2: code,
    l2t: ORPHAN_NAME,
    l3: code,
    l3t: ORPHAN_NAME,
    l4: code,
    l4t: ORPHAN_NAME,
    cm: UNMAPPED,
    category: UNMAPPED,
    owner: UNMAPPED,
  };
}

function indexByL1(rows: { l1: string }[]) {
  const m = new Map<string, number[]>();
  rows.forEach((r, i) => m.set(r.l1, [...(m.get(r.l1) ?? []), i]));
  return m;
}

/** LV1 입력값을 그 계층 품목들에 매출 비중으로 나눠 준다. 배분할 품목이 없으면 onOrphan으로 넘긴다. */
function spreadInputs(
  inputs: ManualInput[],
  idxByL1: Map<string, number[]>,
  weight: (i: number) => number,
  onRow: (i: number, incentive: number, general: number) => void,
  onOrphan: (inp: ManualInput) => void,
) {
  for (const inp of inputs) {
    const idx = idxByL1.get(inp.l1) ?? [];
    const w = idx.map(weight);
    const inc = allocate(inp.incentive, w);
    const gen = allocate(inp.general, w);
    if (inc && gen) idx.forEach((i, j) => onRow(i, inc[j], gen[j]));
    else onOrphan(inp);
  }
}

/** 고객그룹3 장려금을 제품에 나눈 결과. 그 달 그 채널 매출이 없으면 orphans */
export interface ChannelSpread {
  byMatnr: Map<string, number>;
  orphans: ChannelInput[];
}

/** 고객그룹3 장려금을 그 채널의 그 달 제품 매출(양수) 비중으로 제품에 나눈다 */
export function spreadChannel(inputs: ChannelInput[], sales: ChannelSale[]): ChannelSpread {
  const byCh = new Map<string, ChannelSale[]>();
  for (const s of sales) {
    const list = byCh.get(s.ch);
    if (list) list.push(s);
    else byCh.set(s.ch, [s]);
  }
  const byMatnr = new Map<string, number>();
  const orphans: ChannelInput[] = [];
  for (const inp of inputs) {
    if (!inp.incentive) continue;
    const list = byCh.get(inp.ch) ?? [];
    const parts = allocate(inp.incentive, list.map((s) => s.sales));
    if (!parts) {
      orphans.push(inp);
      continue;
    }
    list.forEach((s, j) => byMatnr.set(s.matnr, (byMatnr.get(s.matnr) ?? 0) + parts[j]));
  }
  return { byMatnr, orphans };
}

/** 그 달에 고객그룹3 장려금 입력이 있으면 LV1 입력의 장려금은 쓰지 않는다 (이중 계상 방지). 일반비는 그대로 */
export function lv1InputsFor(inputs: ManualInput[], channelInputs: ChannelInput[], ym: string): ManualInput[] {
  const byChannel = channelInputs.some((c) => c.ym === ym && c.incentive);
  return inputs.filter((i) => i.ym === ym).map((i) => (byChannel ? { ...i, incentive: 0 } : i));
}

/** 채널 장려금 중 제품에 붙일 수 없는 금액을 담는 행 (채널별 하나) */
function channelOrphanDims(ch: string, cht: string): RowDims {
  const code = `CH:${ch}`;
  const label = `(채널 장려금) ${cht || ch}`;
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
    category: UNMAPPED,
    owner: UNMAPPED,
  };
}

/** 채널 장려금을 행에 더한다. 행이 없는 제품·매출 없는 채널은 extra(채널별 행)로 */
function addChannel<R extends RowDims>(
  rows: R[],
  spread: ChannelSpread | undefined,
  extra: Map<string, R>,
  make: (d: RowDims) => R,
  add: (r: R, v: number) => void,
) {
  if (!spread) return;
  const idx = new Map(rows.map((r, i) => [r.matnr, i]));
  const pseudo = (ch: string, cht: string) => {
    const d = channelOrphanDims(ch, cht);
    let r = extra.get(d.matnr);
    if (!r) {
      r = make(d);
      extra.set(d.matnr, r);
    }
    return r;
  };
  for (const [matnr, v] of spread.byMatnr) {
    const i = idx.get(matnr);
    add(i == null ? pseudo('-', '제품 미확인') : rows[i], v);
  }
  for (const inp of spread.orphans) add(pseudo(inp.ch, inp.cht), inp.incentive);
}

export function buildRows(params: {
  facts: MaterialFact[];
  maps: ProductMap[];
  curInputs: ManualInput[];
  prevInputs: ManualInput[];
  elapsed: number;
  daysInMonth: number;
  /** 고객그룹3 장려금 배부 (입력한 달만) */
  curChannel?: ChannelSpread;
  prevChannel?: ChannelSpread;
}): MaterialRow[] {
  const { facts, maps, curInputs, prevInputs, elapsed, daysInMonth, curChannel, prevChannel } = params;
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  const rates = costRates(facts);
  const k = forecastFactor(elapsed, daysInMonth);
  const progress = daysInMonth ? elapsed / daysInMonth : 0;

  const rows: MaterialRow[] = facts.map((f) => {
    const { cogs, method } = estimateCogs(f, rates);
    const mtd = { ...ZERO, sales: f.curSales, qty: f.curQty, cogs };
    return {
      ...dimsOf(f, mapBy.get(f.matnr)),
      costMethod: method,
      mtd,
      fcst: scaleAmounts(mtd, k),
      prev: { ...ZERO, sales: f.prevSales, qty: f.prevQty, cogs: f.prevCogs },
    };
  });

  const idxByL1 = indexByL1(rows);
  const pseudo = new Map<string, MaterialRow>();
  const pseudoRow = (inp: ManualInput): MaterialRow => {
    const hit = pseudo.get(inp.l1);
    if (hit) return hit;
    const r: MaterialRow = { ...orphanDims(inp), costMethod: 'unit', mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } };
    pseudo.set(inp.l1, r);
    return r;
  };

  spreadInputs(
    curInputs,
    idxByL1,
    (i) => rows[i].mtd.sales,
    (i, inc, gen) => {
      rows[i].fcst.incentive += inc;
      rows[i].fcst.general += gen;
      rows[i].mtd.incentive += inc * progress;
      rows[i].mtd.general += gen * progress;
    },
    (inp) => {
      const r = pseudoRow(inp);
      r.fcst.incentive += inp.incentive;
      r.fcst.general += inp.general;
      r.mtd.incentive += inp.incentive * progress;
      r.mtd.general += inp.general * progress;
    },
  );

  spreadInputs(
    prevInputs,
    idxByL1,
    (i) => rows[i].prev.sales,
    (i, inc, gen) => {
      rows[i].prev.incentive += inc;
      rows[i].prev.general += gen;
    },
    (inp) => {
      const r = pseudoRow(inp);
      r.prev.incentive += inp.incentive;
      r.prev.general += inp.general;
    },
  );

  const chRows = new Map<string, MaterialRow>();
  const makeCh = (d: RowDims): MaterialRow => ({ ...d, costMethod: 'unit', mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } });
  addChannel(rows, curChannel, chRows, makeCh, (r, v) => {
    r.fcst.incentive += v;
    r.mtd.incentive += v * progress;
  });
  addChannel(rows, prevChannel, chRows, makeCh, (r, v) => {
    r.prev.incentive += v;
  });

  return [...rows, ...pseudo.values(), ...chRows.values()];
}

/** 마감월 한 달의 품목 손익. 매출·원가는 CO-PA 실적, 장려금·일반비는 그 달 LV1 입력값을 매출 비중으로 배분. */
export function buildMonthRows(params: {
  ym: string;
  facts: MonthFact[];
  maps: ProductMap[];
  inputs: ManualInput[];
  /** 고객그룹3 장려금 배부 (그 달에 입력이 있을 때) */
  channel?: ChannelSpread;
}): MonthRow[] {
  const { ym, facts, maps, inputs, channel } = params;
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  const rows: MonthRow[] = facts
    .filter((f) => f.sales[ym] || f.cogs[ym] || f.qty[ym])
    .map((f) => ({
      ...dimsOf(f, mapBy.get(f.matnr)),
      amt: { ...ZERO, sales: f.sales[ym] ?? 0, qty: f.qty[ym] ?? 0, cogs: f.cogs[ym] ?? 0 },
    }));

  const pseudo = new Map<string, MonthRow>();
  spreadInputs(
    inputs,
    indexByL1(rows),
    (i) => rows[i].amt.sales,
    (i, inc, gen) => {
      rows[i].amt.incentive += inc;
      rows[i].amt.general += gen;
    },
    (inp) => {
      const r = pseudo.get(inp.l1) ?? { ...orphanDims(inp), amt: { ...ZERO } };
      r.amt.incentive += inp.incentive;
      r.amt.general += inp.general;
      pseudo.set(inp.l1, r);
    },
  );
  const chRows = new Map<string, MonthRow>();
  addChannel(rows, channel, chRows, (d) => ({ ...d, amt: { ...ZERO } }), (r, v) => {
    r.amt.incentive += v;
  });
  return [...rows, ...pseudo.values(), ...chRows.values()];
}

/** 분석 축. 제품계층은 코드로 묶고 이름으로 보여준다 (이름이 같은 다른 계층이 섞이지 않도록) */
export type Axis = 'l1' | 'l2' | 'l3' | 'l4' | 'cm' | 'category' | 'owner' | 'name';

export const AXIS_LABEL: Record<Axis, string> = {
  l1: '제품계층 LV1',
  l2: '제품계층 LV2',
  l3: '제품계층 LV3',
  l4: '제품계층 LV4',
  cm: 'CM',
  category: '카테고리',
  owner: '담당자',
  name: '제품',
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

export function totalOf(rows: MaterialRow[]): { mtd: Amounts; fcst: Amounts; prev: Amounts } {
  return rows.reduce(
    (t, r) => ({ mtd: addAmounts(t.mtd, r.mtd), fcst: addAmounts(t.fcst, r.fcst), prev: addAmounts(t.prev, r.prev) }),
    { mtd: { ...ZERO }, fcst: { ...ZERO }, prev: { ...ZERO } },
  );
}
