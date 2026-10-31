// 관리자 전용 손익 인사이트 순수 계산 (시범). 두 달의 제품 × 채널 손익 행으로
//   ① 영업이익 브리지: 기준월 OP → 비교월 OP를 가격·물량·믹스·단위원가·신규/중단·장려금·일반비로 나눈다.
//      동일제품(양쪽 다 수량·매출 양수, 단가 비율 0.2~5배)만 가격·원가를 비교한다.
//        가격 = Σ(P1 − P0)·Q1,  단위원가 = −Σ(U1 − U0)·Q1,  물량+믹스 = Σ(Q1 − Q0)·(P0 − U0)
//        물량 = (ΣQ1 ÷ ΣQ0 − 1) × Σ Q0·(P0 − U0)  — 구성이 그대로인 채 전체 수량만 변했을 때의 이익 변화, 믹스 = 나머지
//      한쪽 달에만 있는 제품은 '신규·중단', 단가를 비교할 수 없는 제품(수량 0·이상 단가)은 '단가 비교불가'로 모은다.
//      → 모든 요인의 합 = 비교월 OP − 기준월 OP (정확히 맞는다)
//   ② 이익 고래곡선: 제품을 이익 큰 순으로 쌓은 누적 이익. 정점 = 흑자 제품만의 이익, 정점 − 최종 = 적자 제품이 깎은 금액
//   ③ 성장 품질 맵: 묶음별 매출·GP율의 기준월 → 비교월 이동. GP 변화 = 매출효과 (순매출 차이 × 기준 GP율) + 마진효과 (비교월 순매출 × GP율 차이)
import { addAmounts, axisKey, axisLabel, metrics, ORPHAN_NAME, ZERO, type Axis } from './pnl.ts';
import type { Amounts, MonthRow } from './types';

/** 동일제품 단가 비교에서 뺄 비율 — lib/pnl.ts priceChange와 같은 기준 */
const PRICE_RATIO_MIN = 0.2;
const PRICE_RATIO_MAX = 5;

export type BridgeFactor = 'price' | 'volume' | 'mix' | 'cost' | 'newgone' | 'other' | 'incentive' | 'general';

export const FACTOR_LABEL: Record<BridgeFactor, string> = {
  price: '판매가격',
  volume: '판매물량',
  mix: '제품 믹스',
  cost: '단위원가',
  newgone: '신규·중단 제품',
  other: '단가 비교불가',
  incentive: '장려금',
  general: '일반비',
};

export const FACTOR_HINT: Record<BridgeFactor, string> = {
  price: '같은 제품의 판매단가 변화 × 비교월 수량',
  volume: '제품 구성이 그대로라고 볼 때 전체 판매수량 증감의 이익 효과',
  mix: '이익률 높은/낮은 제품으로 판매 구성이 옮겨간 효과',
  cost: '같은 제품의 단위원가 변화 × 비교월 수량 (원가 상승 = 음수)',
  newgone: '한쪽 달에만 팔린 제품의 매출총이익(장려금 전)',
  other: '수량이 0이거나 단가가 0.2~5배를 벗어난 제품 (정정·단위 전표)',
  incentive: '채널별 장려금 증감 (증가 = 음수)',
  general: '채널별 일반비 증감 (증가 = 음수)',
};

export interface Contributor {
  label: string;
  value: number;
}

export interface BridgeStep {
  key: BridgeFactor;
  value: number;
  /** |값| 큰 순 상위 기여 제품·채널 */
  top: Contributor[];
}

export interface OpBridge {
  base: number; // 기준월 OP
  cur: number; // 비교월 OP
  steps: BridgeStep[];
  /** 비교월 매출 중 단가 비교가 가능한 제품 비중 (가격·원가 효과의 신뢰도) */
  matchedShare: number | null;
}

const TOP = 6;

function topOf(list: Contributor[], n = TOP): Contributor[] {
  return list
    .filter((c) => Math.abs(c.value) >= 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, n)
    .map((c) => ({ label: c.label, value: Math.round(c.value) }));
}

const isOrphan = (r: MonthRow) => r.name === ORPHAN_NAME;

/** 제품 단위 금액 (채널 비용 보관 행 제외) */
function productTotals(rows: MonthRow[]): Map<string, { name: string; a: Amounts }> {
  const out = new Map<string, { name: string; a: Amounts }>();
  for (const r of rows) {
    if (isOrphan(r)) continue;
    const p = out.get(r.matnr);
    if (p) p.a = addAmounts(p.a, r.amt);
    else out.set(r.matnr, { name: r.name, a: { ...r.amt } });
  }
  return out;
}

const sumRows = (rows: MonthRow[]) => rows.reduce((t, r) => addAmounts(t, r.amt), { ...ZERO });
const exists = (a: Amounts) => a.sales !== 0 || a.cogs !== 0 || a.qty !== 0;

export function opBridge(base: MonthRow[], cur: MonthRow[]): OpBridge {
  const p0 = productTotals(base);
  const p1 = productTotals(cur);
  const keys = new Set([...p0.keys(), ...p1.keys()]);

  type Matched = { name: string; q0: number; q1: number; m0: number; price: number; cost: number };
  const matched: Matched[] = [];
  const newgone: Contributor[] = [];
  const other: Contributor[] = [];
  let matchedSales = 0;
  let curSales = 0;
  for (const k of keys) {
    const a0 = p0.get(k)?.a ?? ZERO;
    const a1 = p1.get(k)?.a ?? ZERO;
    const name = p1.get(k)?.name ?? p0.get(k)?.name ?? k;
    const gm = (a: Amounts) => a.sales - a.cogs;
    curSales += Math.max(a1.sales, 0);
    if (!exists(a0) || !exists(a1)) {
      if (exists(a0) || exists(a1)) newgone.push({ label: `${name}${exists(a1) ? ' (신규)' : ' (중단)'}`, value: gm(a1) - gm(a0) });
      continue;
    }
    const ok = a0.qty > 0 && a1.qty > 0 && a0.sales > 0 && a1.sales > 0;
    const P0 = a0.sales / a0.qty;
    const P1 = a1.sales / a1.qty;
    const ratio = ok ? P1 / P0 : 0;
    if (!ok || ratio < PRICE_RATIO_MIN || ratio > PRICE_RATIO_MAX) {
      other.push({ label: name, value: gm(a1) - gm(a0) });
      continue;
    }
    const U0 = a0.cogs / a0.qty;
    const U1 = a1.cogs / a1.qty;
    matchedSales += a1.sales;
    matched.push({ name, q0: a0.qty, q1: a1.qty, m0: P0 - U0, price: (P1 - P0) * a1.qty, cost: -(U1 - U0) * a1.qty });
  }

  const q0Sum = matched.reduce((s, m) => s + m.q0, 0);
  const q1Sum = matched.reduce((s, m) => s + m.q1, 0);
  const k = q0Sum > 0 ? q1Sum / q0Sum - 1 : 0;
  const vol = matched.map((m) => ({ label: m.name, value: k * m.q0 * m.m0 }));
  const mix = matched.map((m) => ({ label: m.name, value: (m.q1 - m.q0) * m.m0 - k * m.q0 * m.m0 }));
  const price = matched.map((m) => ({ label: m.name, value: m.price }));
  const cost = matched.map((m) => ({ label: m.name, value: m.cost }));

  // 장려금·일반비는 채널 단위로 입력되므로 채널별로 본다 (매출 없는 채널 비용 행 포함)
  const chs = new Map<string, { label: string; i: number; g: number }>();
  const addCh = (rows: MonthRow[], sign: 1 | -1) => {
    for (const r of rows) {
      if (!r.amt.incentive && !r.amt.general) continue;
      const c = chs.get(r.ch) ?? { label: r.cht, i: 0, g: 0 };
      c.i += sign * r.amt.incentive;
      c.g += sign * r.amt.general;
      chs.set(r.ch, c);
    }
  };
  addCh(cur, 1);
  addCh(base, -1);
  const inc = [...chs.values()].map((c) => ({ label: c.label, value: -c.i }));
  const gen = [...chs.values()].map((c) => ({ label: c.label, value: -c.g }));

  const sum = (l: Contributor[]) => l.reduce((s, c) => s + c.value, 0);
  const step = (key: BridgeFactor, list: Contributor[]): BridgeStep => ({ key, value: Math.round(sum(list)), top: topOf(list) });
  return {
    base: Math.round(metrics(sumRows(base)).op),
    cur: Math.round(metrics(sumRows(cur)).op),
    steps: [
      step('price', price),
      step('volume', vol),
      step('mix', mix),
      step('cost', cost),
      step('newgone', newgone),
      step('other', other),
      step('incentive', inc),
      step('general', gen),
    ],
    matchedShare: curSales > 0 ? matchedSales / curSales : null,
  };
}

export type ProfitMetric = 'gp' | 'op';

export interface Whale {
  n: number; // 제품 수
  total: number; // 최종 누적 이익
  peak: number; // 흑자 제품 이익 합 (곡선 정점)
  winners: number; // 흑자 제품 수 (정점 위치)
  losers: number; // 적자 제품 수
  top20: number; // 상위 20% 제품의 누적 이익
  /** [제품 누적 비중 0~1, 누적 이익(원)] — 화면용으로 줄인 점 */
  points: [number, number][];
  best: Contributor[];
  worst: Contributor[];
}

const WHALE_POINTS = 220;

export function whaleCurve(rows: MonthRow[], metric: ProfitMetric): Whale {
  const vals = [...productTotals(rows).values()]
    .filter((p) => exists(p.a))
    .map((p) => ({ label: p.name, value: metrics(p.a)[metric] }))
    .sort((a, b) => b.value - a.value);
  const n = vals.length;
  const cum: number[] = [];
  let acc = 0;
  for (const v of vals) cum.push((acc += v.value));
  const winners = vals.filter((v) => v.value > 0).length;
  const losers = vals.filter((v) => v.value < 0).length;
  const peak = winners ? cum[winners - 1] : 0;

  const stepN = Math.max(1, Math.ceil(n / WHALE_POINTS));
  const idx = new Set<number>();
  for (let i = stepN - 1; i < n; i += stepN) idx.add(i);
  if (winners) idx.add(winners - 1);
  if (n) idx.add(n - 1);
  const points: [number, number][] = [[0, 0], ...[...idx].sort((a, b) => a - b).map((i) => [(i + 1) / n, Math.round(cum[i])] as [number, number])];

  return {
    n,
    total: Math.round(acc),
    peak: Math.round(peak),
    winners,
    losers,
    top20: n ? Math.round(cum[Math.max(0, Math.ceil(n * 0.2) - 1)]) : 0,
    points,
    best: topOf(vals.slice(0, TOP), TOP),
    worst: topOf(vals.filter((v) => v.value < 0).slice(-TOP).reverse(), TOP),
  };
}

export interface MomentumPoint {
  key: string;
  label: string;
  s0: number; // 기준월 총매출
  s1: number;
  m0: number; // 기준월 GP율 (순매출 대비)
  m1: number;
  gp0: number;
  gp1: number;
  /** GP 변화 = 매출효과 + 마진효과 */
  salesEffect: number;
  marginEffect: number;
}

/**
 * 묶음별 기준월 → 비교월 이동. 양쪽 다 순매출이 양수이고 비교월 매출이 전체의 minShare 이상인 묶음만.
 * preIncentive면 장려금을 빼기 전(매출 − 원가) ÷ 총매출로 본다 — 장려금 입력이 한쪽 달에만 있을 때 입력 차이가 섞이지 않게
 */
export function momentum(base: MonthRow[], cur: MonthRow[], axis: Axis, preIncentive = false, minShare = 0.003): MomentumPoint[] {
  const g = new Map<string, { label: string; a0: Amounts; a1: Amounts }>();
  const add = (rows: MonthRow[], which: 'a0' | 'a1') => {
    for (const r of rows) {
      const key = axisKey(r, axis);
      const v = g.get(key) ?? { label: axisLabel(r, axis), a0: { ...ZERO }, a1: { ...ZERO } };
      v[which] = addAmounts(v[which], preIncentive ? { ...r.amt, incentive: 0 } : r.amt);
      g.set(key, v);
    }
  };
  add(base, 'a0');
  add(cur, 'a1');
  const total = [...g.values()].reduce((s, v) => s + Math.max(v.a1.sales, 0), 0);
  const out: MomentumPoint[] = [];
  for (const [key, v] of g) {
    const x0 = metrics(v.a0);
    const x1 = metrics(v.a1);
    if (x0.net <= 0 || x1.net <= 0 || x0.gpm == null || x1.gpm == null) continue;
    if (total > 0 && v.a1.sales / total < minShare) continue;
    out.push({
      key,
      label: v.label,
      s0: Math.round(x0.sales),
      s1: Math.round(x1.sales),
      m0: x0.gpm,
      m1: x1.gpm,
      gp0: Math.round(x0.gp),
      gp1: Math.round(x1.gp),
      salesEffect: Math.round((x1.net - x0.net) * x0.gpm),
      marginEffect: Math.round(x1.net * (x1.gpm - x0.gpm)),
    });
  }
  return out.sort((a, b) => b.s1 - a.s1);
}

/** 성장 품질 맵의 묶음 축 */
export const MOMENTUM_AXES = ['category', 'cm', 'ch', 'l1'] as const;
export type MomentumAxis = (typeof MOMENTUM_AXES)[number];

export type MarginBasis = 'net' | 'pre';

/** 화면 전달 형태 (서버에서 계산해 보낸다) */
export interface InsightPair {
  id: string;
  baseLabel: string; // 예: '9월 실적'
  curLabel: string; // 예: '10월 예상'
  /** 비교월이 진행 중인 달(예상)이면 원가가 3개월 평균 단위원가 기준 */
  fcst: boolean;
  /** 장려금·일반비 입력이 덜 된 달 안내 (예: '9월 12/20개 채널') */
  coverage: string[];
  bridge: OpBridge;
  /** net = 장려금 반영 GP율, pre = 장려금 전 매출이익률 */
  momentum: Record<MomentumAxis, Record<MarginBasis, MomentumPoint[]>>;
}

export interface InsightWhale {
  id: string;
  label: string;
  gp: Whale;
  op: Whale;
}

export interface InsightData {
  pairs: InsightPair[]; // 최근 비교부터
  whales: InsightWhale[];
  /** 최근 달에 장려금·일반비 입력이 있어 영업이익을 기준으로 볼 수 있는지 */
  opReady: boolean;
  dataDate: string | null;
}

/** 장려금·일반비 입력으로 생기는 요인 — 입력이 덜 된 달끼리 비교하면 입력 차이가 섞인다 */
export const INPUT_FACTORS: BridgeFactor[] = ['incentive', 'general'];

/** 화면 첫 선택·요약에 쓸 가장 큰 요인. 입력이 덜 된 비교면 장려금·일반비를 빼고 고른다 */
export function headlineFactor(b: OpBridge, inputsComplete: boolean): BridgeStep | undefined {
  return b.steps
    .filter((s) => inputsComplete || !INPUT_FACTORS.includes(s.key))
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))[0];
}

/** 성장 품질 구분: 매출·GP율이 함께 오르면 good, 매출만 오르면 hollow(속 빈 성장) */
export type MomentumKind = 'good' | 'hollow' | 'defend' | 'decline';
export function momentumKind(p: Pick<MomentumPoint, 's0' | 's1' | 'm0' | 'm1'>): MomentumKind {
  const up = p.s1 >= p.s0;
  const better = p.m1 >= p.m0;
  return up ? (better ? 'good' : 'hollow') : better ? 'defend' : 'decline';
}
