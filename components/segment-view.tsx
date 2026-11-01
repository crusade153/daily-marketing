'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cmRank } from '@/lib/pnl';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { eok, mil, pct } from '@/lib/format';
import { GRADE_NET_CUT } from '@/lib/grade';
import {
  BAND_LABEL,
  BASE_OF,
  GRADE_NAME,
  GRADE_RANK,
  gradeTrend,
  shiftLabel,
  inScope,
  isRateMetric,
  LEVEL_LABEL,
  LEVELS,
  migration,
  pareto,
  QUADRANTS,
  SEG_METRIC_LABEL,
  SEG_PERIODS,
  segment,
  toUnits,
  type Cut,
  type CutMethod,
  type ParetoBand,
  type Quadrant,
  type SegMetric,
  type SegPeriod,
  type SegPoint,
  type SegProduct,
  type Trend,
} from '@/lib/segment';
import { GradeChip, GradeShift } from './grade-chip';

export interface SegmentPeriodMeta {
  id: SegPeriod;
  label: string;
  costNote: string | null;
  /** 등급 변동 비교 기준으로만 쓰는 기간 (분석 기간 버튼에는 없음) */
  compareOnly?: boolean;
}

// 사분면 이름은 X = 규모, Y = 손익 기준 (A·C 손익+, B·D 손익−). 다른 지표를 고르면 부제(↑·↓)로 읽는다
// 색은 신호등 순서 A 초록 > C 노랑 > B 주황 > D 빨강
const Q_META: Record<Quadrant, { name: string; color: string; hx: boolean; hy: boolean }> = {
  A: { name: GRADE_NAME.A, color: 'var(--seg-a)', hx: true, hy: true },
  B: { name: GRADE_NAME.B, color: 'var(--seg-b)', hx: true, hy: false },
  C: { name: GRADE_NAME.C, color: 'var(--seg-c)', hx: false, hy: true },
  D: { name: GRADE_NAME.D, color: 'var(--seg-d)', hx: false, hy: false },
};

/** 등급 변동 상세 필터: null 전체 · 'AB' 칸 · 'A*' 전월 A · '*B' 당월 B · 변화 종류 */
type MoveFilter = string | null;
const TREND_ORDER: Record<Trend, number> = { down: 0, up: 1, new: 2, gone: 3, same: 4 };
const TREND_CHIPS: { id: Trend; label: string }[] = [
  { id: 'down', label: '▼ 악화' },
  { id: 'up', label: '▲ 개선' },
  { id: 'same', label: '유지' },
  { id: 'new', label: '신규' },
  { id: 'gone', label: '판매 없음' },
];
const HIST: SegPeriod[] = ['prev2', 'prev', 'fcst'];
/** 분석 기간 버튼 순서: 고른 달 예상 → 전월 실적 → 올해 누계 */
const PERIOD_ORDER: SegPeriod[] = ['fcst', 'prev', 'ytd'];
interface MoveRow {
  key: string;
  unit: SegPoint['unit'];
  before: SegPoint | null;
  after: SegPoint | null;
  trend: Trend;
}

const METRICS: SegMetric[] = ['net', 'sales', 'qty', 'gp', 'op', 'gpm', 'opm', 'growth'];
const PARETO_METRICS: SegMetric[] = ['net', 'sales', 'qty', 'gp', 'op'];
/** 순매출·총매출 X축 기본 기준 금액, 바 상한 (그 이상은 숫자로 입력) */
const AMOUNT_CUT = GRADE_NET_CUT;
const AMOUNT_BAR_MAX = 1e9;
const AMOUNT_BAR_STEP = 1e7;
const isSalesMetric = (m: SegMetric) => m === 'net' || m === 'sales';
const amountCut = (c: Cut): Cut => ({ ...c, method: 'manual', manual: AMOUNT_CUT });
/** 기준 금액 표시: 1억 이상 억, 그 아래 만원 */
const won = (v: number) => (Math.abs(v) >= 1e8 ? `${+(v / 1e8).toFixed(2)}억원` : `${Math.round(v / 1e4).toLocaleString()}만원`);
const BANDS: ParetoBand[] = ['core', 'support', 'tail', 'none'];
const PAGE = 200;
const AXIS_TICK = { fontSize: 11, fill: 'var(--viz-axis)' };

const PRESETS: { label: string; x: SegMetric; xc: CutMethod; y: SegMetric; yc: CutMethod }[] = [
  { label: '순매출 × 영업이익', x: 'net', xc: 'manual', y: 'op', yc: 'zero' },
  { label: '순매출 × GP율', x: 'net', xc: 'manual', y: 'gpm', yc: 'mean' },
  { label: '순매출 × 성장률', x: 'net', xc: 'manual', y: 'growth', yc: 'mean' },
  { label: '수량 × 매출총이익', x: 'qty', xc: 'pareto', y: 'gp', yc: 'zero' },
];

const qtyFmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 0 });
const minus = (s: string) => s.replace('-', '−');

/** 표·툴팁 표시: 금액 백만원, 수량 EA, 비율 % */
function fmtVal(m: SegMetric, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  if (isRateMetric(m)) return minus(pct(v));
  if (m === 'qty') return minus(qtyFmt.format(v));
  return minus(mil(v));
}
const unitOf = (m: SegMetric) => (isRateMetric(m) ? '%' : m === 'qty' ? 'EA' : '백만원');
/** 축 눈금: 비율 %, 수량 만 단위 축약, 금액은 범위가 크면 억·작으면 백만 */
const tickOf = (m: SegMetric, span: number) => (v: number) => {
  if (isRateMetric(m)) return minus(`${Math.round(v * 100)}%`);
  if (m === 'qty') return minus(compact.format(v));
  return minus(span >= 4e8 ? `${+(v / 1e8).toFixed(1)}억` : `${Math.round(v / 1e6)}백만`);
};
/** 직접 입력값 ↔ 원단위 */
const toInput = (m: SegMetric, v: number) => (isRateMetric(m) ? +(v * 100).toFixed(1) : m === 'qty' ? Math.round(v) : Math.round(v / 1e6));
const fromInput = (m: SegMetric, v: number) => (isRateMetric(m) ? v / 100 : m === 'qty' ? v : v * 1e6);

function methodsFor(m: SegMetric): { id: CutMethod; label: string }[] {
  if (isRateMetric(m)) {
    return [
      { id: 'mean', label: '전체 평균(가중)' },
      { id: 'median', label: '중앙값' },
      { id: 'zero', label: '0%' },
      { id: 'manual', label: '직접 입력' },
    ];
  }
  if (isSalesMetric(m)) {
    return [
      { id: 'manual', label: '기준 금액' },
      { id: 'pareto', label: '상위 누적 비중' },
      { id: 'median', label: '중앙값' },
      { id: 'mean', label: '평균' },
    ];
  }
  return [
    { id: 'pareto', label: '상위 누적 비중' },
    { id: 'median', label: '중앙값' },
    { id: 'mean', label: '평균' },
    ...(m === 'gp' || m === 'op' ? [{ id: 'zero' as const, label: '0 (흑자/적자)' }] : []),
    { id: 'manual', label: '직접 입력' },
  ];
}

const quantile = (sorted: number[], q: number) => sorted[Math.round(q * (sorted.length - 1))];

/** 극단값 몇 개가 점들을 한쪽에 몰아넣지 않도록 1~99 백분위 + 기준선까지를 축 범위로 */
/** 1·2·5 간격으로 맞춘 범위와 눈금 */
function niceTicks([lo, hi]: [number, number]): { domain: [number, number]; ticks: number[] } {
  const raw = (hi - lo) / 5 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { domain: [a, b], ticks };
}

/** 극단값 몇 개가 점들을 한쪽에 몰아넣지 않도록 백분위 범위 + 기준선까지를 축 범위로.
 *  비율 지표는 작은 분모에서 튀는 값이 많아 5~95, 금액·수량은 1~99 백분위 */
function domainOf(values: number[], cut: number, rate: boolean): [number, number] {
  const s = [...values].sort((a, b) => a - b);
  const q = rate ? 0.05 : 0.01;
  let lo = s.length >= 20 ? quantile(s, q) : s[0];
  let hi = s.length >= 20 ? quantile(s, 1 - q) : s[s.length - 1];
  lo = Math.min(lo, cut);
  hi = Math.max(hi, cut);
  const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.1 || 1;
  return [s[0] >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad];
}

/** 순위 백분위(0~100). 값이 같으면 같은 위치 */
function percentiles(values: number[]): { of: (v: number) => number } {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const below = (v: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return { of: (v) => (n <= 1 ? 50 : (below(v) / (n - 1)) * 100) };
}

interface Pt {
  key: string;
  label: string;
  code: string;
  count: number;
  q: Quadrant;
  px: number; // 화면 좌표 (잘림·순위 반영)
  py: number;
  x: number; // 실제 값
  y: number;
  z: number;
  clipped: boolean;
}

function CutControl({
  axis,
  metric,
  cut,
  value,
  period,
  onMetric,
  onCut,
}: {
  axis: 'X' | 'Y';
  metric: SegMetric;
  cut: Cut;
  value: number | null;
  period: SegPeriod;
  onMetric: (m: SegMetric) => void;
  onCut: (c: Cut) => void;
}) {
  const methods = methodsFor(metric);
  return (
    <div className="seg-cut">
      <span className="seg-axis-tag">{axis}축</span>
      <select value={metric} onChange={(e) => onMetric(e.target.value as SegMetric)} aria-label={`${axis}축 지표`}>
        {METRICS.map((m) => (
          <option key={m} value={m} disabled={m === 'growth' && !BASE_OF[period]}>
            {SEG_METRIC_LABEL[m]}
            {m === 'growth' ? ' (전월 대비)' : ''}
          </option>
        ))}
      </select>
      <span className="text-muted">기준</span>
      <select
        value={cut.method}
        aria-label={`${axis}축 기준선`}
        onChange={(e) => {
          const method = e.target.value as CutMethod;
          // 직접 입력은 지금 기준선에서 시작해 조정한다
          onCut({ ...cut, method, manual: method === 'manual' && value != null ? value : cut.manual });
        }}
      >
        {methods.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {cut.method === 'pareto' && (
        <label className="seg-slider">
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={Math.round(cut.pareto * 100)}
            onChange={(e) => onCut({ ...cut, pareto: Number(e.target.value) / 100 })}
            aria-label={`${axis}축 상위 누적 비중`}
          />
          <b>{Math.round(cut.pareto * 100)}%</b>
        </label>
      )}
      {cut.method === 'manual' && isSalesMetric(metric) && (
        <label className="seg-slider seg-amount">
          <input
            type="range"
            min={0}
            max={AMOUNT_BAR_MAX}
            step={AMOUNT_BAR_STEP}
            value={Math.min(Math.max(cut.manual, 0), AMOUNT_BAR_MAX)}
            onChange={(e) => onCut({ ...cut, manual: Number(e.target.value) })}
            aria-label={`${axis}축 기준 금액`}
          />
          <b>{won(cut.manual)}</b>
        </label>
      )}
      {cut.method === 'manual' && (
        <label className="seg-manual">
          <input
            type="number"
            min={isSalesMetric(metric) ? 0 : undefined}
            value={toInput(metric, cut.manual)}
            step={isRateMetric(metric) ? 0.5 : isSalesMetric(metric) ? 10 : 1}
            title={isSalesMetric(metric) ? '바 상한(10억)보다 큰 금액은 여기에 백만원 단위로 입력' : undefined}
            onChange={(e) => onCut({ ...cut, manual: fromInput(metric, Number(e.target.value) || 0) })}
            aria-label={`${axis}축 기준값 (${unitOf(metric)})`}
          />
          <span className="text-muted">{unitOf(metric)}</span>
        </label>
      )}
      <span className="seg-cut-value" title="현재 기준선 값">
        = {fmtVal(metric, value)}
        {value != null && !isRateMetric(metric) && metric !== 'qty' ? '백만' : ''}
      </span>
    </div>
  );
}

const segmentHref = (ch: string, ym: string | null) => {
  const q = new URLSearchParams();
  if (ch) q.set('ch', ch);
  if (ym) q.set('ym', ym);
  const s = q.toString();
  return s ? `/segment?${s}` : '/segment';
};

export default function SegmentView({
  products,
  periods,
  channels,
  channel,
  monthYm = null,
}: {
  products: SegProduct[];
  periods: SegmentPeriodMeta[];
  /** 채널(고객그룹3) 필터 — 바꾸면 서버에서 그 채널 금액만 다시 모은다 */
  channels: { code: string; name: string }[];
  channel: string | null;
  /** 지난달을 기준월로 볼 때 그 달 (채널을 바꿔도 유지) */
  monthYm?: string | null;
}) {
  const router = useRouter();
  const [chPending, startCh] = useTransition();
  // 기본은 위 ‹ › 에서 고른 달의 예상 (누계는 따로 골라야 한다 — 2026-11-01 사용자 피드백)
  const [period, setPeriod] = useState<SegPeriod>('fcst');
  const [productQ, setProductQ] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const [byChild, setByChild] = useState(false);
  const [xm, setXm] = useState<SegMetric>('net');
  const [ym, setYm] = useState<SegMetric>('op');
  const [xc, setXc] = useState<Cut>({ method: 'manual', pareto: 0.8, manual: AMOUNT_CUT });
  const [yc, setYc] = useState<Cut>({ method: 'zero', pareto: 0.8, manual: 0 });
  const [rank, setRank] = useState(false);
  const [pm, setPm] = useState<SegMetric>('net');
  const [focusQ, setFocusQ] = useState<Quadrant | null>(null);
  const [cmp, setCmp] = useState<'fcst' | 'prev'>('fcst');
  const [move, setMoveRaw] = useState<MoveFilter>(null); // 등급 변동 상세 필터 (null = 전체 품목)
  const [moveLimit, setMoveLimit] = useState(PAGE);
  const setMove = (v: MoveFilter | ((m: MoveFilter) => MoveFilter)) => {
    setMoveRaw(v);
    setMoveLimit(PAGE);
  };
  const [band, setBand] = useState<ParetoBand | ''>('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const pi = SEG_PERIODS.indexOf(period);
  const meta = periods.find((p) => p.id === period) ?? periods[0];
  const base = BASE_OF[period];
  const periodLabel = (id: SegPeriod) => periods.find((p) => p.id === id)?.label ?? id;
  const childLevel = path.length < LEVELS.length ? LEVELS[path.length] : null;
  const unit = byChild && childLevel ? childLevel : 'product';
  const unitName = unit === 'product' ? '제품' : LEVEL_LABEL[unit];

  const resetFilters = () => {
    setFocusQ(null);
    setMove(null);
    setSelected(null);
    setLimit(PAGE);
  };

  // ── 계층 선택지 (상위 선택 안에서, 기간 매출 큰 순) ──
  const levelOptions = useMemo(
    () =>
      LEVELS.map((lv, i) => {
        if (i > path.length) return [];
        const m = new Map<string, { label: string; sales: number }>();
        for (const p of inScope(products, path.slice(0, i))) {
          const v = m.get(p[lv]) ?? { label: p[lv], sales: 0 };
          v.sales += p.a[pi][0];
          m.set(p[lv], v);
        }
        // CM은 CM1 → CM2 → CM3 → (미매핑) → 기타 순, PM은 매출 큰 순
        return [...m].sort((a, b) => (lv === 'cm' ? cmRank(a[0]) - cmRank(b[0]) : 0) || b[1].sales - a[1].sales);
      }),
    [products, path, pi],
  );

  // 제품 필터: 제품명·제품코드에 검색어가 들어간 제품만 범위에 남긴다
  const scoped = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    const list = inScope(products, path);
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.matnr.toLowerCase().includes(q)) : list;
  }, [products, path, productQ]);
  const units = useMemo(() => toUnits(scoped, unit), [scoped, unit]);
  const seg = useMemo(() => segment(units, period, xm, ym, xc, yc), [units, period, xm, ym, xc, yc]);
  // 등급 변동은 위 분석 기간과 별개로 두 달을 고른다 (기본 전월 실적 → 당월 예상)
  const cmpFrom = BASE_OF[cmp] as SegPeriod;
  const segFrom = useMemo(() => segment(units, cmpFrom, xm, ym, xc, yc), [units, cmpFrom, xm, ym, xc, yc]);
  const segTo = useMemo(() => segment(units, cmp, xm, ym, xc, yc), [units, cmp, xm, ym, xc, yc]);
  const moves = useMemo(() => (segFrom && segTo ? migration(segFrom, segTo) : null), [segFrom, segTo]);
  // 등급 히스토리: 전전월 · 전월 · 당월을 같은 기준으로 다시 나눈 등급
  const histPeriods = useMemo(() => HIST.filter((id) => periods.some((p) => p.id === id)), [periods]);
  const hist = useMemo(
    () => new Map(histPeriods.map((id) => [id, new Map((segment(units, id, xm, ym, xc, yc)?.points ?? []).map((p) => [p.unit.key, p.q]))])),
    [histPeriods, units, xm, ym, xc, yc],
  );
  // 모든 품목의 변동: 악화 → 개선 → 신규 → 판매 없음 → 유지 순, 악화·개선은 Y 변화가 큰 순
  const allMoves = useMemo((): MoveRow[] => {
    if (!segFrom || !segTo) return [];
    const from = new Map(segFrom.points.map((p) => [p.unit.key, p]));
    const to = new Map(segTo.points.map((p) => [p.unit.key, p]));
    const rows: MoveRow[] = [];
    for (const key of new Set([...from.keys(), ...to.keys()])) {
      const before = from.get(key) ?? null;
      const after = to.get(key) ?? null;
      const trend = gradeTrend(before?.q ?? null, after?.q ?? null);
      if (trend) rows.push({ key, unit: (after ?? before)!.unit, before, after, trend });
    }
    const dy = (r: MoveRow) => (r.after?.y ?? 0) - (r.before?.y ?? 0);
    const size = (r: MoveRow) => r.after?.x ?? r.before?.x ?? 0;
    return rows.sort(
      (a, b) =>
        TREND_ORDER[a.trend] - TREND_ORDER[b.trend] ||
        (a.trend === 'down' ? dy(a) - dy(b) : a.trend === 'up' ? dy(b) - dy(a) : size(b) - size(a)),
    );
  }, [segFrom, segTo]);
  const trendCount = useMemo(() => {
    const c: Record<Trend, number> = { down: 0, up: 0, same: 0, new: 0, gone: 0 };
    for (const r of allMoves) c[r.trend] += 1;
    return c;
  }, [allMoves]);
  const moveRows = useMemo(() => {
    if (!move) return allMoves;
    if (move in TREND_ORDER) return allMoves.filter((r) => r.trend === move);
    const [f, t] = move;
    return allMoves.filter((r) => r.before && r.after && (f === '*' || r.before.q === f) && (t === '*' || r.after.q === t));
  }, [allMoves, move]);
  const moveLabel = !move
    ? '전체'
    : move in TREND_ORDER
      ? TREND_CHIPS.find((c) => c.id === move)!.label
      : move[0] === '*'
        ? `당월 ${move[1]}`
        : move[1] === '*'
          ? `전월 ${move[0]}`
          : `${move[0]} → ${move[1]}`;
  const par = useMemo(() => pareto(units, period, pm), [units, period, pm]);
  const ptOf = useMemo(() => new Map(seg?.points.map((p) => [p.unit.key, p]) ?? []), [seg]);

  // ── 사분면 요약 ──
  const summary = useMemo(() => {
    // sales = 순매출, gross = 총매출 (영업이익률은 다른 화면처럼 총매출 대비)
    const s = Object.fromEntries(QUADRANTS.map((q) => [q, { n: 0, sales: 0, gross: 0, op: 0 }])) as Record<
      Quadrant,
      { n: number; sales: number; gross: number; op: number }
    >;
    let sales = 0;
    for (const p of seg?.points ?? []) {
      const a = p.unit.amt[pi];
      const net = a.sales - a.incentive - a.general;
      s[p.q].n += 1;
      s[p.q].sales += net;
      s[p.q].gross += a.sales;
      s[p.q].op += net - a.cogs;
      sales += net;
    }
    return { s, sales, n: seg?.points.length ?? 0 };
  }, [seg, pi]);

  // ── 매트릭스 점 ──
  const plot = useMemo(() => {
    if (!seg || !seg.points.length) return null;
    const xs = seg.points.map((p) => p.x);
    const ys = seg.points.map((p) => p.y);
    const xp = percentiles(xs);
    const yp = percentiles(ys);
    // 순위 척도는 0·100에 놓인 점이 잘리지 않게 양 끝을 조금 띄운다
    const rankAxis = { domain: [-4, 104] as [number, number], ticks: [0, 20, 40, 60, 80, 100] };
    const xn = rank ? rankAxis : niceTicks(domainOf(xs, seg.cx, isRateMetric(xm)));
    const yn = rank ? rankAxis : niceTicks(domainOf(ys, seg.cy, isRateMetric(ym)));
    const xd = xn.domain;
    const yd = yn.domain;
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
    const pts: Pt[] = seg.points.map((p) => {
      const px = rank ? xp.of(p.x) : clamp(p.x, xd);
      const py = rank ? yp.of(p.y) : clamp(p.y, yd);
      return {
        key: p.unit.key,
        label: p.unit.label,
        code: p.unit.code,
        count: p.unit.count,
        q: p.q,
        x: p.x,
        y: p.y,
        px,
        py,
        z: Math.max(p.unit.amt[pi].sales, 0),
        clipped: !rank && (px !== p.x || py !== p.y),
      };
    });
    return { pts, xd, yd, xt: xn.ticks, yt: yn.ticks, cx: rank ? xp.of(seg.cx) : seg.cx, cy: rank ? yp.of(seg.cy) : seg.cy };
  }, [seg, rank, pi, xm, ym]);

  // ── 파레토 곡선 (점 200개 이내로 줄임) ──
  const curve = useMemo(() => {
    const pos = par.rows.filter((r) => r.cum != null);
    const n = pos.length;
    if (!n) return { data: [], core: 0, n: 0 };
    const step = Math.max(1, Math.floor(n / 200));
    const data = [{ x: 0, y: 0, k: 0 }];
    pos.forEach((r, i) => {
      if (i % step === 0 || i === n - 1) data.push({ x: ((i + 1) / n) * 100, y: (r.cum ?? 0) * 100, k: i + 1 });
    });
    return { data, core: pos.filter((r) => r.band === 'core').length, n };
  }, [par]);

  // ── 리스트 ──
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return par.rows.filter(
      (r) =>
        (!focusQ || ptOf.get(r.unit.key)?.q === focusQ) &&
        (!band || r.band === band) &&
        (!q || r.unit.label.toLowerCase().includes(q) || r.unit.code.toLowerCase().includes(q)),
    );
  }, [par, focusQ, ptOf, band, query]);

  const setLevel = (i: number, code: string) => {
    setPath(code ? [...path.slice(0, i), code] : path.slice(0, i));
    resetFilters();
  };
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setXm(p.x);
    setYm(p.y);
    setXc((c) => (p.xc === 'manual' && isSalesMetric(p.x) ? amountCut(c) : { ...c, method: p.xc }));
    setYc((c) => ({ ...c, method: p.yc }));
    if ((p.x === 'growth' || p.y === 'growth') && !base) setPeriod('fcst');
    resetFilters();
  };
  const changeMetric = (axis: 'x' | 'y', m: SegMetric) => {
    const fix = (c: Cut): Cut => {
      // 순매출↔총매출은 같은 원 단위라 기준 금액을 그대로 둔다
      const prev = axis === 'x' ? xm : ym;
      if (c.method === 'manual' && isSalesMetric(m) && isSalesMetric(prev)) return c;
      if (methodsFor(m).some((x) => x.id === c.method) && c.method !== 'manual') return c;
      if (isSalesMetric(m)) return amountCut(c);
      return { ...c, method: isRateMetric(m) ? 'mean' : 'pareto' };
    };
    if (axis === 'x') {
      setXm(m);
      setXc(fix);
    } else {
      setYm(m);
      setYc(fix);
    }
    resetFilters();
  };

  const usesOp = [xm, ym, pm].some((m) => m === 'op' || m === 'opm' || m === 'net');
  const xLabel = SEG_METRIC_LABEL[xm];
  const yLabel = SEG_METRIC_LABEL[ym];
  const scopeLabel = path.length ? path.map((code, i) => levelOptions[i].find(([k]) => k === code)?.[1].label ?? code).join(' › ') : '전체';
  const showX = pm !== xm;
  const showY = pm !== ym;

  return (
    <div className="seg-page">
      {/* ── 조건 ── */}
      <div className="card seg-controls">
        <div className="seg-row">
          <span className="seg-row-title">분석 기간</span>
          <div className="segmented seg-period-pick" role="group" aria-label="분석 기간 (매트릭스·등급 요약·등급 변동 모두)">
            {PERIOD_ORDER.flatMap((id) => periods.filter((p) => p.id === id && !p.compareOnly)).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => {
                  setPeriod(p.id);
                  // 월 기간을 고르면 등급 변동도 그 달 기준으로 맞춘다
                  if (p.id === 'fcst' || p.id === 'prev') {
                    setCmp(p.id);
                    setMove(null);
                  }
                  resetFilters();
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="seg-levels" aria-label="범위 선택">
            {LEVELS.map((lv, i) => (
              <label key={lv} className={i > path.length ? 'is-disabled' : ''}>
                <span>{LEVEL_LABEL[lv]}</span>
                <select value={path[i] ?? ''} disabled={i > path.length} onChange={(e) => setLevel(i, e.target.value)}>
                  <option value="">{i > path.length ? '—' : '전체'}</option>
                  {levelOptions[i].map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                {i < LEVELS.length - 1 && <i aria-hidden="true">›</i>}
              </label>
            ))}
            <label>
              <span>제품</span>
              <input
                className="seg-product-q"
                value={productQ}
                onChange={(e) => {
                  setProductQ(e.target.value);
                  resetFilters();
                }}
                placeholder="제품명·코드"
                aria-label="제품 필터"
              />
            </label>
            <label>
              <span>채널</span>
              <select
                value={channel ?? ''}
                disabled={chPending}
                onChange={(e) => {
                  const v = e.target.value;
                  resetFilters();
                  startCh(() => router.push(segmentHref(v, monthYm), { scroll: false }));
                }}
                aria-label="채널 필터"
              >
                <option value="">전체</option>
                {channels.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            {(path.length > 0 || productQ) && (
              <button type="button" className="seg-link" onClick={() => { setProductQ(''); setLevel(0, ''); }}>
                초기화
              </button>
            )}
          </div>
          <div className="segmented" role="group" aria-label="점 단위">
            <button type="button" aria-pressed={unit === 'product'} onClick={() => { setByChild(false); resetFilters(); }}>
              제품
            </button>
            <button type="button" aria-pressed={unit !== 'product'} disabled={!childLevel} onClick={() => { setByChild(true); resetFilters(); }}>
              하위 묶음{childLevel ? ` (${LEVEL_LABEL[childLevel]})` : ''}
            </button>
          </div>
        </div>
        <div className="seg-row seg-sandbox">
          <span className="seg-row-title">시뮬레이션</span>
          <CutControl axis="X" metric={xm} cut={xc} value={seg?.cx ?? null} period={period} onMetric={(m) => changeMetric('x', m)} onCut={(c) => { setXc(c); resetFilters(); }} />
          <CutControl axis="Y" metric={ym} cut={yc} value={seg?.cy ?? null} period={period} onMetric={(m) => changeMetric('y', m)} onCut={(c) => { setYc(c); resetFilters(); }} />
          <div className="segmented" role="group" aria-label="축 척도">
            <button type="button" aria-pressed={!rank} onClick={() => setRank(false)}>실제값</button>
            <button type="button" aria-pressed={rank} onClick={() => setRank(true)} title="값 대신 범위 안 순위(0~100)로 펼쳐 봅니다">순위</button>
          </div>
          <div className="seg-presets">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => applyPreset(p)} aria-pressed={xm === p.x && ym === p.y && xc.method === p.xc && yc.method === p.yc}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {(usesOp && meta.costNote) || (seg && seg.excluded > 0) ? (
          <p className="seg-note">
            {usesOp && meta.costNote && <span>{meta.costNote} — 미입력 채널은 순매출이 총매출과, 영업이익이 매출총이익과 같습니다.</span>}
            {seg && seg.excluded > 0 && <span>{xLabel}·{yLabel} 값이 없는 {unitName} {seg.excluded}개 제외 (매출 0인 이익률, 비교 기간 매출 0인 성장률 등)</span>}
          </p>
        ) : null}
      </div>

      {/* ── 매트릭스 + 사분면 요약 ── */}
      <div className="seg-main">
        <section className="card seg-matrix" aria-labelledby="seg-matrix-title">
          <div className="panel-heading">
            <div>
              <h2 id="seg-matrix-title">ABCD 등급 분포</h2>
              <p>
                <b className="seg-period-badge">{meta.label}</b> {scopeLabel} · {unitName} {summary.n.toLocaleString()}개 · X {xLabel} / Y {yLabel}
              </p>
            </div>
            <span className="unit-label">점을 누르면 리스트에서 강조</span>
          </div>
          <div className="seg-chart">
            {plot && <span className="seg-y-title">↑ {yLabel}{rank ? ' 순위(0~100)' : ''}</span>}
            {plot ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 18, bottom: 22, left: 6 }}>
                  <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="0" />
                  {QUADRANTS.map((q) => {
                    const m = Q_META[q];
                    return (
                      <ReferenceArea
                        key={q}
                        x1={m.hx ? plot.cx : plot.xd[0]}
                        x2={m.hx ? plot.xd[1] : plot.cx}
                        y1={m.hy ? plot.cy : plot.yd[0]}
                        y2={m.hy ? plot.yd[1] : plot.cy}
                        fill={m.color}
                        fillOpacity={focusQ && focusQ !== q ? 0.02 : 0.07}
                        stroke="none"
                        label={{
                          value: `${q} ${m.name}`,
                          position: m.hx ? (m.hy ? 'insideTopRight' : 'insideBottomRight') : m.hy ? 'insideTopLeft' : 'insideBottomLeft',
                          fill: 'var(--text)',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      />
                    );
                  })}
                  <XAxis
                    type="number"
                    dataKey="px"
                    domain={plot.xd}
                    ticks={plot.xt}
                    allowDataOverflow
                    tick={AXIS_TICK}
                    tickFormatter={rank ? (v: number) => `${Math.round(v)}` : tickOf(xm, plot.xd[1] - plot.xd[0])}
                    label={{ value: `${xLabel}${rank ? ' 순위(0~100)' : ''} →`, position: 'insideBottom', offset: -12, fontSize: 11, fill: 'var(--viz-axis)' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="py"
                    domain={plot.yd}
                    ticks={plot.yt}
                    allowDataOverflow
                    width={58}
                    tick={AXIS_TICK}
                    tickFormatter={rank ? (v: number) => `${Math.round(v)}` : tickOf(ym, plot.yd[1] - plot.yd[0])}
                  />
                  <ZAxis type="number" dataKey="z" range={unit === 'product' ? [36, 36] : [60, 700]} />
                  <ReferenceLine x={plot.cx} stroke="var(--text)" strokeOpacity={0.55} strokeDasharray="4 3" />
                  <ReferenceLine y={plot.cy} stroke="var(--text)" strokeOpacity={0.55} strokeDasharray="4 3" />
                  <Tooltip
                    cursor={false}
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0]?.payload as Pt | undefined;
                      if (!p) return null;
                      return (
                        <div className="seg-tip">
                          <b>{p.label}</b>
                          <span className="text-muted">
                            {p.code}
                            {p.count > 1 ? ` · 제품 ${p.count}개` : ''}
                          </span>
                          <span>
                            <i style={{ background: Q_META[p.q].color }} /> {p.q} {Q_META[p.q].name}
                          </span>
                          <span>{xLabel} {fmtVal(xm, p.x)}{isRateMetric(xm) ? '' : ` ${unitOf(xm)}`}</span>
                          <span>{yLabel} {fmtVal(ym, p.y)}{isRateMetric(ym) ? '' : ` ${unitOf(ym)}`}</span>
                          {p.clipped && <span className="text-muted">축 범위 밖 — 가장자리에 표시</span>}
                        </div>
                      );
                    }}
                  />
                  {QUADRANTS.map((q) => (
                    <Scatter
                      key={q}
                      name={`${q} ${Q_META[q].name}`}
                      data={plot.pts.filter((p) => p.q === q)}
                      fill={Q_META[q].color}
                      fillOpacity={focusQ && focusQ !== q ? 0.12 : 0.75}
                      stroke="var(--surface)"
                      strokeWidth={1}
                      isAnimationActive={false}
                      onClick={(d: { payload?: Pt }) => d?.payload && setSelected((s) => (s === d.payload!.key ? null : d.payload!.key))}
                      className="cursor-pointer"
                    />
                  ))}
                  {selected && plot.pts.some((p) => p.key === selected) && (
                    <Scatter
                      data={plot.pts.filter((p) => p.key === selected)}
                      fill="none"
                      stroke="var(--text)"
                      strokeWidth={2}
                      isAnimationActive={false}
                      shape={(props: { cx?: number; cy?: number }) => <circle cx={props.cx} cy={props.cy} r={9} fill="none" stroke="var(--text)" strokeWidth={2} />}
                      legendType="none"
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="seg-empty">
                {(xm === 'growth' || ym === 'growth') && !base
                  ? '매출 성장률은 월 단위 기간(당월 예상·전월 실적)에서 전월 대비로 계산됩니다.'
                  : '선택한 조건에 표시할 실적이 없습니다.'}
              </div>
            )}
          </div>
        </section>

        <aside className="seg-side">
          <div className="seg-quads" role="group" aria-label="등급 요약 (누르면 리스트 필터)">
            {QUADRANTS.map((q) => {
              const s = summary.s[q];
              const m = Q_META[q];
              return (
                <button
                  key={q}
                  type="button"
                  className={`card seg-quad g-${q}`}
                  aria-pressed={focusQ === q}
                  onClick={() => {
                    setFocusQ((f) => (f === q ? null : q));
                    setLimit(PAGE);
                  }}
                >
                  <span className="seg-quad-head">
                    <GradeChip q={q} /> {m.name}
                  </span>
                  <span className="seg-quad-sub">
                    {xLabel}
                    {m.hx ? '↑' : '↓'} · {yLabel}
                    {m.hy ? '↑' : '↓'}
                  </span>
                  <span className="seg-quad-n num">
                    {s.n.toLocaleString()}
                    <small>개 ({summary.n ? pct(s.n / summary.n, 0) : '-'})</small>
                  </span>
                  <span className="seg-quad-kv">
                    <span>순매출</span>
                    <b className="num">{eok(s.sales)}</b>
                    <span className="num text-muted">{summary.sales ? pct(s.sales / summary.sales, 0) : '-'}</span>
                  </span>
                  <span className="seg-quad-kv">
                    <span>영업이익</span>
                    <b className={`num ${s.op < 0 ? 'text-neg' : ''}`}>{minus(eok(s.op))}</b>
                    <span className="num text-muted">{s.gross ? minus(pct(s.op / s.gross)) : '-'}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <section className="card seg-move" aria-labelledby="seg-move-title">
            <div className="panel-heading">
              <div>
                <h2 id="seg-move-title">등급 변동</h2>
                <p>
                  전월 등급(행) → 당월 등급(열) · 칸·합계를 누르면 아래 상세
                  {period === 'ytd' && <span className="seg-move-ytd"> · 누계에는 월 비교가 없어 아래에서 고른 두 달로 봅니다</span>}
                </p>
              </div>
            </div>
            <div className="segmented seg-move-pick" role="group" aria-label="등급 변동 비교 기간">
              {(['fcst', 'prev'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={cmp === id}
                  onClick={() => {
                    setCmp(id);
                    setMove(null);
                    // 누계를 보는 중이 아니면 위 분석 기간도 같은 달로 맞춘다
                    if (period !== 'ytd') {
                      setPeriod(id);
                      resetFilters();
                    }
                  }}
                >
                  {periodLabel(BASE_OF[id] as SegPeriod)} → {periodLabel(id)}
                </button>
              ))}
            </div>
            {moves ? (
              <>
                <table className="seg-move-table">
                  <thead>
                    <tr>
                      <th scope="col" className="seg-move-corner" title={`전월 = ${periodLabel(cmpFrom)}, 당월 = ${periodLabel(cmp)}`}>
                        전월＼당월
                      </th>
                      {QUADRANTS.map((q) => (
                        <th key={q} scope="col">
                          <button type="button" className="seg-move-axis" aria-pressed={move === `*${q}`} onClick={() => setMove((m) => (m === `*${q}` ? null : `*${q}`))} title={`당월 ${q} ${GRADE_NAME[q]} 전체`}>
                            <GradeChip q={q} />
                          </button>
                        </th>
                      ))}
                      <th scope="col" className="seg-move-sum">전월 계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {QUADRANTS.map((from) => {
                      const rowSum = QUADRANTS.reduce((t, to) => t + (moves.get(`${from}${to}`)?.length ?? 0), 0);
                      return (
                        <tr key={from}>
                          <th scope="row">
                            <button type="button" className="seg-move-axis" aria-pressed={move === `${from}*`} onClick={() => setMove((m) => (m === `${from}*` ? null : `${from}*`))} title={`전월 ${from} ${GRADE_NAME[from]} 전체`}>
                              <GradeChip q={from} />
                            </button>
                          </th>
                          {QUADRANTS.map((to) => {
                            const k = `${from}${to}`;
                            const n = moves.get(k)?.length ?? 0;
                            const d = GRADE_RANK[to] - GRADE_RANK[from];
                            return (
                              <td key={to} className={d === 0 ? 'is-stay' : d < 0 ? 'is-down' : 'is-up'}>
                                <button
                                  type="button"
                                  disabled={!n}
                                  aria-pressed={move === k}
                                  title={`${from} → ${to}: ${n}개${d < 0 ? ' (악화)' : d > 0 ? ' (개선)' : ''}`}
                                  onClick={() => setMove((m) => (m === k ? null : k))}
                                >
                                  {n || '·'}
                                </button>
                              </td>
                            );
                          })}
                          <td className="is-sum">
                            <button type="button" disabled={!rowSum} aria-pressed={move === `${from}*`} onClick={() => setMove((m) => (m === `${from}*` ? null : `${from}*`))}>
                              {rowSum}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="seg-move-total">
                      <th scope="row">당월 계</th>
                      {QUADRANTS.map((to) => {
                        const colSum = QUADRANTS.reduce((t, from) => t + (moves.get(`${from}${to}`)?.length ?? 0), 0);
                        return (
                          <td key={to} className="is-sum">
                            <button type="button" disabled={!colSum} aria-pressed={move === `*${to}`} onClick={() => setMove((m) => (m === `*${to}` ? null : `*${to}`))}>
                              {colSum}
                            </button>
                          </td>
                        );
                      })}
                      <td className="is-sum is-grand">
                        <button type="button" aria-pressed={move === null} onClick={() => setMove(null)} title="전체 품목">
                          {trendCount.down + trendCount.up + trendCount.same}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="seg-move-foot">
                  <span className="text-neg">▼ 악화 {trendCount.down}</span> · <span className="text-pos">▲ 개선 {trendCount.up}</span> · 유지 {trendCount.same}
                  {trendCount.new + trendCount.gone > 0 && ` · 신규 ${trendCount.new} · 판매 없음 ${trendCount.gone} (표 밖)`}
                  <br />
                  전월 {periodLabel(cmpFrom)} · 당월 {periodLabel(cmp)} · 빨간 칸 = 악화, 초록 칸 = 개선 (A &gt; C &gt; B &gt; D)
                </p>
              </>
            ) : (
              <p className="seg-empty">선택한 조건에 비교할 실적이 없습니다.</p>
            )}
          </section>
        </aside>
      </div>

      {/* ── 등급 변동 상세: 모든 품목의 등급 히스토리 ── */}
      <section className="card seg-list" aria-labelledby="seg-moves-title">
        <div className="seg-list-head">
          <h2 id="seg-moves-title">등급 변동 상세</h2>
          <span className="text-muted">
            {periodLabel(cmpFrom)} → {periodLabel(cmp)} · {moveLabel} {unitName} {moveRows.length.toLocaleString()}개
          </span>
          <div className="seg-trend-chips" role="group" aria-label="변화 종류로 거르기">
            <button type="button" aria-pressed={move === null} onClick={() => setMove(null)}>
              전체 <b className="num">{allMoves.length.toLocaleString()}</b>
            </button>
            {TREND_CHIPS.map((c) => (
              <button key={c.id} type="button" className={`t-${c.id}`} aria-pressed={move === c.id} disabled={!trendCount[c.id]} onClick={() => setMove((m) => (m === c.id ? null : c.id))}>
                {c.label} <b className="num">{trendCount[c.id].toLocaleString()}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="seg-list-scroll seg-moves-scroll">
          <table className="dtable seg-dtable seg-moves-table">
            <thead>
              <tr>
                <th className="text-left">{unitName}</th>
                <th className="text-left">등급 변화</th>
                <th className="text-left" title="같은 기준으로 다시 나눈 월별 등급">히스토리 ({histPeriods.map((id) => periodLabel(id).split(' ')[0]).join(' · ')})</th>
                <th className="num">{xLabel} 전월</th>
                <th className="num">{xLabel} 당월</th>
                <th className="num">{yLabel} 전월</th>
                <th className="num">{yLabel} 당월</th>
                <th className="num">{yLabel} 증감</th>
              </tr>
            </thead>
            <tbody>
              {moveRows.slice(0, moveLimit).map(({ key, unit: u, before, after, trend }) => {
                const shift = before && after ? shiftLabel(before.q, after.q) : null;
                const dy = before && after ? after.y - before.y : null;
                return (
                  <tr key={key} className={`mv-${trend} ${selected === key ? 'is-selected' : ''}`} onClick={() => setSelected((s) => (s === key ? null : key))}>
                    <td className="seg-name" title={`${u.code} ${u.label}`}>
                      <span>{u.label}</span>
                      <small>{u.code}{u.count > 1 ? ` · 제품 ${u.count}개` : ''}</small>
                    </td>
                    <td>
                      <GradeShift from={before?.q ?? null} to={after?.q ?? null} trend={trend} />
                      {shift && <small className={`mv-shift ${shift === '적자 전환' ? 'is-alarm' : shift === '흑자 전환' ? 'is-good' : ''}`}>{shift}</small>}
                    </td>
                    <td>
                      <span className="mv-hist">
                        {histPeriods.map((id, i) => {
                          const q = hist.get(id)?.get(key) ?? null;
                          const on = id === cmpFrom || id === cmp;
                          return (
                            <span key={id} className={on ? '' : 'is-off'}>
                              {i > 0 && <i aria-hidden="true">›</i>}
                              <GradeChip q={q} faded={!on} />
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td className="num text-muted">{fmtVal(xm, before?.x)}</td>
                    <td className="num font-semibold">{fmtVal(xm, after?.x)}</td>
                    <td className={`num text-muted ${before && before.y < 0 ? 'text-neg' : ''}`}>{fmtVal(ym, before?.y)}</td>
                    <td className={`num font-semibold ${after && after.y < 0 ? 'text-neg' : ''}`}>{fmtVal(ym, after?.y)}</td>
                    <td className={`num ${dy == null || dy === 0 ? 'text-muted' : dy < 0 ? 'text-neg' : 'text-pos'}`}>
                      {dy == null ? '-' : `${dy > 0 ? '+' : ''}${fmtVal(ym, dy)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {moveRows.length > moveLimit && (
            <div className="border-t border-border p-3 text-center">
              <button type="button" onClick={() => setMoveLimit((n) => n + PAGE)} className="rounded-md px-4 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
                {Math.min(PAGE, moveRows.length - moveLimit)}개 더 보기 (남은 {(moveRows.length - moveLimit).toLocaleString()}개)
              </button>
            </div>
          )}
          {!moveRows.length && <p className="seg-empty">해당하는 {unitName}이 없습니다.</p>}
        </div>
        <p className="seg-list-foot">
          금액 백만원 · 전월 {periodLabel(cmpFrom)}, 당월 {periodLabel(cmp)} · 악화(빨강) → 개선(초록) → 신규 → 판매 없음 → 유지(흐리게) 순, 악화·개선은 {yLabel} 변화가 큰 순 · 기준선은 각 달 안에서 다시 계산(기준 금액·0 기준은 그대로)
        </p>
      </section>

      {/* ── 파레토 ── */}
      <div className="seg-pareto">
        <section className="card seg-curve" aria-labelledby="seg-curve-title">
          <div className="panel-heading">
            <div>
              <h2 id="seg-curve-title">상위 품목 집중도</h2>
              <p>
                {curve.n
                  ? `상위 ${curve.core.toLocaleString()}개 ${unitName}(${pct(curve.core / curve.n, 0)})가 ${SEG_METRIC_LABEL[pm]}의 80%`
                  : `${SEG_METRIC_LABEL[pm]}이 양(+)인 ${unitName}이 없습니다.`}
              </p>
            </div>
            <select value={pm} onChange={(e) => { setPm(e.target.value as SegMetric); setLimit(PAGE); }} aria-label="집중도 기준 지표" className="seg-select">
              {PARETO_METRICS.map((m) => (
                <option key={m} value={m}>{SEG_METRIC_LABEL[m]} 기준</option>
              ))}
            </select>
          </div>
          <div className="seg-curve-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve.data} margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[0, 100]}
                  ticks={[0, 20, 40, 60, 80, 100]}
                  tick={AXIS_TICK}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: `${unitName} 누적 비율 (큰 순)`, position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--viz-axis)' }}
                />
                <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} width={44} tick={AXIS_TICK} tickFormatter={(v: number) => `${v}%`} />
                <ReferenceLine y={80} stroke="var(--seg-a)" strokeDasharray="4 3" label={{ value: '80% 핵심', position: 'insideBottomRight', fontSize: 11, fill: 'var(--text)' }} />
                <ReferenceLine y={95} stroke="var(--viz-axis)" strokeDasharray="4 3" label={{ value: '95% 중요', position: 'insideBottomRight', fontSize: 11, fill: 'var(--text)' }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--viz-grid)" strokeDasharray="2 3" />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const p = active && (payload?.[0]?.payload as { x: number; y: number; k: number } | undefined);
                    if (!p) return null;
                    return (
                      <div className="seg-tip">
                        <b>상위 {p.k.toLocaleString()}개 ({p.x.toFixed(0)}%)</b>
                        <span>{SEG_METRIC_LABEL[pm]} 누적 {p.y.toFixed(1)}%</span>
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="y" stroke="var(--seg-a)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="seg-bands">
            {BANDS.map((b) => {
              const n = par.rows.filter((r) => r.band === b).length;
              return (
                <button key={b} type="button" aria-pressed={band === b} onClick={() => { setBand((x) => (x === b ? '' : b)); setLimit(PAGE); }}>
                  <span>{BAND_LABEL[b]}</span>
                  <b className="num">{n.toLocaleString()}</b>
                </button>
              );
            })}
          </div>
          <p className="seg-band-note">큰 순으로 더해 핵심 = 누적 80%까지, 중요 = 95%까지, 일반 = 나머지, 손실·없음 = {SEG_METRIC_LABEL[pm]} 0 이하</p>
        </section>

        <section className="card seg-list" aria-labelledby="seg-list-title">
          <div className="seg-list-head">
            <h2 id="seg-list-title">주요 품목 리스트</h2>
            <span className="text-muted">
              {SEG_METRIC_LABEL[pm]} 큰 순 · {list.length.toLocaleString()}개
              {focusQ && ` · ${focusQ} ${Q_META[focusQ].name}`}
              {band && ` · ${BAND_LABEL[band]}`}
            </span>
            {(focusQ || band) && (
              <button type="button" className="seg-link" onClick={() => { setFocusQ(null); setBand(''); }}>
                필터 해제
              </button>
            )}
            <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder={`${unitName}명·코드 검색`} aria-label="주요 품목 검색" />
          </div>
          <div className="seg-list-scroll">
            <table className="dtable seg-dtable">
              <thead>
                <tr>
                  <th className="num">순위</th>
                  <th className="text-left">{unitName}</th>
                  <th>등급</th>
                  <th>중요도</th>
                  <th className="num">{SEG_METRIC_LABEL[pm]}</th>
                  <th className="num">비중</th>
                  <th className="num">누적</th>
                  {showX && <th className="num">{xLabel}</th>}
                  {showY && <th className="num">{yLabel}</th>}
                </tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((r) => {
                  const pt = ptOf.get(r.unit.key);
                  const q = pt?.q;
                  return (
                    <tr
                      key={r.unit.key}
                      className={selected === r.unit.key ? 'is-selected' : ''}
                      onClick={() => setSelected((s) => (s === r.unit.key ? null : r.unit.key))}
                    >
                      <td className="num text-muted">{r.rank}</td>
                      <td className="seg-name" title={`${r.unit.code} ${r.unit.label}`}>
                        <span>{r.unit.label}</span>
                        <small>{r.unit.code}{r.unit.count > 1 ? ` · 제품 ${r.unit.count}개` : ''}</small>
                      </td>
                      <td>
                        {q ? (
                          <span className="seg-badge"><i style={{ background: Q_META[q].color }} />{q} {Q_META[q].name}</span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td><span className={`seg-band band-${r.band}`}>{BAND_LABEL[r.band]}</span></td>
                      <td className="num font-semibold">{fmtVal(pm, r.value)}</td>
                      <td className="num">{r.share == null ? '-' : pct(r.share)}</td>
                      <td className="num text-muted">{r.cum == null ? '-' : pct(r.cum)}</td>
                      {showX && <td className="num">{fmtVal(xm, pt?.x)}</td>}
                      {showY && <td className={`num ${pt && pt.y < 0 ? 'text-neg' : ''}`}>{fmtVal(ym, pt?.y)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length > limit && (
              <div className="border-t border-border p-3 text-center">
                <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="rounded-md px-4 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
                  {Math.min(PAGE, list.length - limit)}개 더 보기 (남은 {(list.length - limit).toLocaleString()}개)
                </button>
              </div>
            )}
            {!list.length && <p className="seg-empty">조건에 맞는 {unitName}이 없습니다.</p>}
          </div>
          <p className="seg-list-foot">금액 백만원, 수량 EA · 행을 누르면 그래프에서 강조</p>
        </section>
      </div>
    </div>
  );
}
