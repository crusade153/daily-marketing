// 세그먼트(ABCD 매트릭스)·파레토 순수 계산.
//   점 = 제품 또는 선택한 범위의 하위 묶음(CM › PM). X·Y 지표와 기준선을 바꿔 가며 A~D를 나눈다.
//   A = X↑·Y↑, B = X↓·Y↑, C = X↑·Y↓, D = X↓·Y↓  (기준선 이상이면 ↑)
//   기준선은 선택 범위 안의 점들로 다시 계산한다 → 범위를 좁히면 같은 제품도 등급이 바뀔 수 있다.
//   파레토: 양(+)의 값만 큰 순으로 누적. 누적 80%까지 '핵심', 95%까지 '중요', 나머지 '일반', 0 이하는 '손실·없음'.
import { metrics } from './pnl.ts';
import type { Amounts } from './types';

/** 분석 기간. prev2는 전월 실적의 비교 기준으로만 쓴다 */
export const SEG_PERIODS = ['ytd', 'fcst', 'prev', 'prev2'] as const;
export type SegPeriod = (typeof SEG_PERIODS)[number];
/** 성장률·세그먼트 이동의 비교 기준 기간 */
export const BASE_OF: Partial<Record<SegPeriod, SegPeriod>> = { fcst: 'prev', prev: 'prev2' };

/** [매출, 수량(EA), 매출원가, 장려금, 일반비] */
export type SegAmounts = [number, number, number, number, number];

/** 제품 1개의 기간별 금액. a[i]는 SEG_PERIODS 순서 */
export interface SegProduct {
  matnr: string;
  name: string;
  cm: string;
  cmMark: string;
  owner: string;
  category: string;
  l1t: string;
  a: SegAmounts[];
}

/** net = 순매출 = 총매출 − 장려금 (2026-10-30 사용자 정의). 미입력이면 총매출과 같다 */
export type SegMetric = 'net' | 'sales' | 'qty' | 'gp' | 'op' | 'gpm' | 'opm' | 'growth';
export const SEG_METRIC_LABEL: Record<SegMetric, string> = {
  net: '순매출',
  sales: '총매출',
  qty: '판매수량',
  gp: '매출총이익',
  op: '영업이익',
  gpm: 'GP율',
  opm: '영업이익률',
  growth: '총매출 성장률',
};
export const isRateMetric = (m: SegMetric) => m === 'gpm' || m === 'opm' || m === 'growth';

export type CutMethod = 'median' | 'mean' | 'pareto' | 'zero' | 'manual';
export interface Cut {
  method: CutMethod;
  pareto: number; // 파레토 누적 비중 (0~1)
  manual: number; // 직접 입력값 (지표 원단위: 원·EA·비율)
}

export type Quadrant = 'A' | 'B' | 'C' | 'D';
export const QUADRANTS: Quadrant[] = ['A', 'B', 'C', 'D'];

/** 범위 선택 단계: CM › PM (제품은 검색, 채널은 서버 필터) */
export type Level = 'cm' | 'owner';
export const LEVELS: Level[] = ['cm', 'owner'];
export const LEVEL_LABEL: Record<Level, string> = { cm: 'CM', owner: 'PM' };

/** 매트릭스에 찍는 점 (제품 또는 계층 묶음) */
export interface SegUnit {
  key: string;
  label: string;
  code: string; // 제품코드 또는 계층코드
  count: number; // 묶인 제품 수
  amt: Amounts[]; // SEG_PERIODS 순서
}

export const toAmounts = ([sales, qty, cogs, incentive, general]: SegAmounts): Amounts => ({ sales, qty, cogs, incentive, general });

/** 선택한 계층 경로(앞에서부터 코드)에 속하는 제품 */
export function inScope(products: SegProduct[], path: string[]): SegProduct[] {
  return products.filter((p) => path.every((code, i) => p[LEVELS[i]] === code));
}

/** 제품 그대로(unit = 'product') 또는 계층 레벨로 묶는다 */
export function toUnits(products: SegProduct[], unit: Level | 'product'): SegUnit[] {
  if (unit === 'product') {
    return products.map((p) => ({ key: p.matnr, label: p.name, code: p.matnr, count: 1, amt: p.a.map(toAmounts) }));
  }
  const map = new Map<string, SegUnit>();
  for (const p of products) {
    const key = p[unit];
    let u = map.get(key);
    if (!u) {
      u = { key, label: p[unit], code: '', count: 0, amt: p.a.map(() => ({ sales: 0, qty: 0, cogs: 0, incentive: 0, general: 0 })) };
      map.set(key, u);
    }
    u.count += 1;
    p.a.forEach((v, i) => {
      const t = u.amt[i];
      t.sales += v[0];
      t.qty += v[1];
      t.cogs += v[2];
      t.incentive += v[3];
      t.general += v[4];
    });
  }
  return [...map.values()];
}

/** 점 하나의 지표값. 정의되지 않으면 null (매출 0인 이익률, 비교 기간 매출 0인 성장률 등) */
export function unitValue(u: SegUnit, period: SegPeriod, metric: SegMetric): number | null {
  const i = SEG_PERIODS.indexOf(period);
  const m = metrics(u.amt[i]);
  if (metric === 'net') return m.net;
  if (metric !== 'growth') return m[metric];
  const base = BASE_OF[period];
  if (!base) return null;
  const b = u.amt[SEG_PERIODS.indexOf(base)].sales;
  return b > 0 ? m.sales / b - 1 : null;
}

/** 비율 지표의 전체(가중) 값 — 이익률은 합계 이익 ÷ 합계 매출 */
function weightedRate(units: SegUnit[], period: SegPeriod, metric: SegMetric): number | null {
  const i = SEG_PERIODS.indexOf(period);
  let num = 0;
  let den = 0;
  for (const u of units) {
    const m = metrics(u.amt[i]);
    if (metric === 'growth') {
      const base = BASE_OF[period];
      if (!base) return null;
      const b = u.amt[SEG_PERIODS.indexOf(base)].sales;
      if (b <= 0) continue;
      num += m.sales;
      den += b;
    } else {
      num += metric === 'gpm' ? m.gp : m.op;
      den += m.net;
    }
  }
  if (den <= 0) return null;
  return metric === 'growth' ? num / den - 1 : num / den;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** 큰 순으로 누적해 share(0~1)에 처음 닿는 값. 그 값 이상이 '상위' 그룹이 된다 */
export function paretoCut(values: number[], share: number): number | null {
  const pos = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = pos.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  let cum = 0;
  for (const v of pos) {
    cum += v;
    if (cum / total >= share - 1e-12) return v;
  }
  return pos[pos.length - 1];
}

/** 기준선. 파레토는 금액·수량 지표에만, 비율 지표의 평균은 가중평균 */
export function cutValue(units: SegUnit[], period: SegPeriod, metric: SegMetric, cut: Cut): number | null {
  const values = units.map((u) => unitValue(u, period, metric)).filter((v): v is number => v != null);
  if (!values.length) return null;
  switch (cut.method) {
    case 'zero':
      return 0;
    case 'manual':
      return cut.manual;
    case 'median':
      return median(values);
    case 'mean':
      return isRateMetric(metric) ? weightedRate(units, period, metric) : values.reduce((s, v) => s + v, 0) / values.length;
    case 'pareto':
      return isRateMetric(metric) ? weightedRate(units, period, metric) : paretoCut(values, cut.pareto);
  }
}

export function quadrantOf(x: number, y: number, cx: number, cy: number): Quadrant {
  const hx = x >= cx;
  const hy = y >= cy;
  return hx ? (hy ? 'A' : 'C') : hy ? 'B' : 'D';
}

/** 그 기간에 매출·수량·원가가 하나라도 있는 점 (실적 없는 제품은 매트릭스·파레토에서 뺀다) */
export function activeIn(units: SegUnit[], period: SegPeriod): SegUnit[] {
  const i = SEG_PERIODS.indexOf(period);
  return units.filter((u) => u.amt[i].sales || u.amt[i].qty || u.amt[i].cogs);
}

export interface SegPoint {
  unit: SegUnit;
  x: number;
  y: number;
  q: Quadrant;
}

export interface Segmentation {
  points: SegPoint[];
  cx: number;
  cy: number;
  excluded: number; // X 또는 Y 값이 없어 제외한 점
}

export function segment(
  units: SegUnit[],
  period: SegPeriod,
  xm: SegMetric,
  ym: SegMetric,
  xc: Cut,
  yc: Cut,
): Segmentation | null {
  const act = activeIn(units, period);
  const cx = cutValue(act, period, xm, xc);
  const cy = cutValue(act, period, ym, yc);
  if (cx == null || cy == null) return null;
  const points: SegPoint[] = [];
  let excluded = 0;
  for (const unit of act) {
    const x = unitValue(unit, period, xm);
    const y = unitValue(unit, period, ym);
    if (x == null || y == null) {
      excluded += 1;
      continue;
    }
    points.push({ unit, x, y, q: quadrantOf(x, y, cx, cy) });
  }
  return { points, cx, cy, excluded };
}

/** 기간 간 세그먼트 이동: from[q1][q2] = 개수. 두 기간 모두 값이 있는 점만 */
export function migration(before: Segmentation, after: Segmentation) {
  const prev = new Map(before.points.map((p) => [p.unit.key, p.q]));
  const cells = new Map<string, string[]>();
  for (const p of after.points) {
    const from = prev.get(p.unit.key);
    if (!from) continue;
    const k = `${from}${p.q}`;
    cells.set(k, [...(cells.get(k) ?? []), p.unit.key]);
  }
  return cells;
}

export type ParetoBand = 'core' | 'support' | 'tail' | 'none';
export const BAND_LABEL: Record<ParetoBand, string> = {
  core: '핵심',
  support: '중요',
  tail: '일반',
  none: '손실·없음',
};

export interface ParetoRow {
  unit: SegUnit;
  value: number | null;
  share: number | null; // 양(+)의 합계 대비
  cum: number | null; // 누적 비중
  band: ParetoBand;
  rank: number;
}

/** 큰 순 정렬 + 누적 비중. core·support 경계는 누적 비중 coreAt·supportAt */
export function pareto(
  units: SegUnit[],
  period: SegPeriod,
  metric: SegMetric,
  coreAt = 0.8,
  supportAt = 0.95,
): { rows: ParetoRow[]; total: number } {
  const withV = activeIn(units, period).map((unit) => ({ unit, value: unitValue(unit, period, metric) }));
  withV.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const total = withV.reduce((s, r) => s + (r.value != null && r.value > 0 ? r.value : 0), 0);
  let cum = 0;
  let prevCum = 0;
  const rows = withV.map((r, i): ParetoRow => {
    if (r.value == null || r.value <= 0 || total <= 0) {
      return { ...r, share: null, cum: null, band: 'none', rank: i + 1 };
    }
    prevCum = cum;
    cum += r.value / total;
    // 경계를 넘기는 항목까지 앞 그룹에 넣는다 (80%에 닿게 만드는 제품이 핵심)
    const band: ParetoBand = prevCum < coreAt - 1e-12 ? 'core' : prevCum < supportAt - 1e-12 ? 'support' : 'tail';
    return { ...r, share: r.value / total, cum, band, rank: i + 1 };
  });
  return { rows, total };
}
