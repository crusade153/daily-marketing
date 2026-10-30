// 월별 추이 순수 계산. 월별 품목 손익 행 → 축별 월 시계열, 전월 대비 차이 브리지.
import { addAmounts, axisKey, axisLabel, cmGroupRank, metrics, ZERO, type Axis } from './pnl.ts';
import type { Amounts, MaterialRow, MonthRow } from './types';

/** actual = 마감월 CO-PA 실적, fcst = 진행 중인 달 예상 */
export type MonthKind = 'actual' | 'fcst';

export interface TrendMonth {
  ym: string;
  kind: MonthKind;
  filled: number; // 장려금·일반비를 입력한 채널(고객그룹3) 수
  chTotal: number; // 그 달 매출이 있는 채널 수
}

export interface MonthBlock extends TrendMonth {
  rows: MonthRow[];
}

export interface TrendSeries {
  key: string; // 묶는 기준 (제품계층은 코드)
  label: string; // 화면 표시 이름
  marks?: string[]; // CM 축 순서용 시트 CM 표시 (행마다)
  months: Amounts[]; // TrendData.months와 같은 순서
}

export interface TrendData {
  axis: Axis;
  months: TrendMonth[];
  total: Amounts[];
  groups: TrendSeries[]; // 기간 매출 합계 큰 순
  dataDate: string | null;
}

export type TrendMetric = 'sales' | 'gp' | 'gpm' | 'op' | 'opm';
export type AmountMetric = 'sales' | 'gp' | 'op';

export const METRIC_LABEL: Record<TrendMetric, string> = {
  sales: '총매출',
  gp: '매출총이익',
  gpm: 'GP율',
  op: '영업이익',
  opm: 'OP율',
};

export const isRate = (m: TrendMetric) => m === 'gpm' || m === 'opm';
/** 장려금·일반비 입력이 있어야 의미가 있는 지표 */
export const needsInput = (m: TrendMetric) => m === 'op' || m === 'opm';
/** 비율 지표의 분자 금액 */
export const amountOf = (m: TrendMetric): AmountMetric => (m === 'gpm' ? 'gp' : m === 'opm' ? 'op' : m);

export function metricValue(a: Amounts, m: TrendMetric): number | null {
  return metrics(a)[m];
}

/** 당월 손익 행을 한 달치 행으로 바꾼다 (scenario 금액만 남김) */
export function toMonthRows(rows: MaterialRow[], pick: 'fcst' | 'prev' | 'mtd'): MonthRow[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return rows.map(({ costMethod, mtd, fcst, prev, ...dims }) => ({ ...dims, amt: { mtd, fcst, prev }[pick] }));
}

export function aggregateTrend(blocks: MonthBlock[], axis: Axis): Pick<TrendData, 'total' | 'groups'> {
  const n = blocks.length;
  const total = blocks.map(() => ({ ...ZERO }));
  const map = new Map<string, TrendSeries>();
  blocks.forEach((b, i) => {
    for (const r of b.rows) {
      const key = axisKey(r, axis);
      let g = map.get(key);
      if (!g) {
        g = { key, label: axisLabel(r, axis), marks: [], months: Array.from({ length: n }, () => ({ ...ZERO })) };
        map.set(key, g);
      }
      g.marks?.push(r.cmMark);
      g.months[i] = addAmounts(g.months[i], r.amt);
      total[i] = addAmounts(total[i], r.amt);
    }
  });
  const salesSum = (g: TrendSeries) => g.months.reduce((s, a) => s + a.sales, 0);
  const rank = (g: TrendSeries) => (axis === 'cm' ? cmGroupRank(g.label, g.marks ?? []) : 0);
  // marks는 정렬에만 쓰고 화면으로 보내지 않는다
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const groups = [...map.values()].sort((a, b) => rank(a) - rank(b) || salesSum(b) - salesSum(a)).map(({ marks, ...g }) => g);
  return { total, groups };
}

export function sumAmounts(list: Amounts[]): Amounts {
  return list.reduce(addAmounts, { ...ZERO });
}

export interface BridgeStep {
  key: string;
  label: string;
  delta: number;
  from: number; // 막대 시작 (누적, 0 기준)
  to: number; // 막대 끝
  total?: boolean; // 마지막 '전체 차이' 막대
}

/**
 * 전월 대비 차이 브리지. 0에서 출발해 그룹별 차이를 쌓고, 마지막 막대가 전체 차이다.
 * 차이가 큰 top개만 남기고 나머지는 '기타 N개'로 묶는다. 각 막대의 합 = 전체 차이.
 */
export function buildBridge(groups: TrendSeries[], i: number, metric: AmountMetric, top = 8): BridgeStep[] {
  if (i <= 0) return [];
  const val = (a: Amounts) => metricValue(a, metric) ?? 0;
  const deltas = groups
    .map((g) => ({ key: g.key, label: g.label, delta: val(g.months[i]) - val(g.months[i - 1]) }))
    .filter((d) => Math.abs(d.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const head = deltas.slice(0, top).sort((a, b) => b.delta - a.delta);
  const tail = deltas.slice(top);
  if (tail.length) {
    const label = `기타 ${tail.length}개`;
    head.push({ key: '__rest', label, delta: tail.reduce((s, d) => s + d.delta, 0) });
  }

  const steps: BridgeStep[] = [];
  let acc = 0;
  for (const d of head) {
    steps.push({ ...d, from: acc, to: acc + d.delta });
    acc += d.delta;
  }
  steps.push({ key: '__total', label: '전체 차이', delta: acc, from: 0, to: acc, total: true });
  return steps;
}
