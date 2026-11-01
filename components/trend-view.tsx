'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { mil, pct } from '@/lib/format';
import { AXIS_LABEL, metrics, type Axis } from '@/lib/pnl';
import { dateLabel, monthLabel } from '@/lib/period';
import {
  amountOf,
  buildBridge,
  isRate,
  METRIC_LABEL,
  metricValue,
  needsInput,
  sumAmounts,
  type AmountMetric,
  type TrendData,
  type TrendMetric,
} from '@/lib/trend';
import type { Amounts } from '@/lib/types';
import AnalysisTabs from './analysis-tabs';

const METRICS: TrendMetric[] = ['sales', 'gp', 'gpm', 'op', 'opm'];
const ANIM = 150;
const AXIS_TICK = { fontSize: 12, fill: 'var(--viz-axis)' };

// 음수 부호는 하이픈 대신 '−'(U+2212) — 작은 글씨에서도 보이도록
const minus = (s: string) => s.replace('-', '−');
const eokNum = (v: number) => minus((v / 1e8).toFixed(Math.abs(v) >= 1e10 ? 0 : 1));
const eokTick = (v: number) => minus((v / 1e8).toFixed(0));
const signedEok = (v: number) => {
  const r = Math.round(v / 1e7) / 10;
  return r === 0 ? '0.0억' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}억`;
};

// 히트맵 척도: 순차(파랑) / 발산(빨강 ← 회색 0 → 파랑). 진한 칸(3단계 이상)은 흰 글씨.
const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
const RED = ['#fadcdb', '#f4b5b3', '#ec8c8a', '#e34948', '#c13a39', '#9a2d2c'];

function heat(v: number | null, cap: number, diverging: boolean): { bg?: string; fg?: string } {
  if (v == null || !Number.isFinite(v) || cap <= 0) return {};
  const t = Math.min(Math.abs(v) / cap, 1);
  if (diverging && t < 0.08) return { bg: 'var(--viz-mid)' };
  const idx = Math.min(5, Math.floor(t * 6));
  const ramp = diverging && v < 0 ? RED : BLUE;
  return { bg: ramp[idx], fg: idx >= 3 ? '#ffffff' : undefined };
}

/** 극단값 하나가 척도를 망치지 않도록 |값|의 90번째 백분위를 상한으로 */
function capOf(values: number[]): number {
  const abs = values.filter((v) => Number.isFinite(v)).map(Math.abs).sort((a, b) => a - b);
  if (!abs.length) return 0;
  return abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))] || abs[abs.length - 1];
}

const fmtCell = (v: number | null, m: TrendMetric) => (v == null ? '-' : isRate(m) ? pct(v) : mil(v));

export default function TrendView({ data, axes, ym = null }: { data: TrendData; axes: Axis[]; ym?: string | null }) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [metric, setMetric] = useState<TrendMetric>('gpm');
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const { months, total, groups, axis } = data;
  const n = months.length;
  const actualIdx = months.flatMap((m, i) => (m.kind === 'actual' ? [i] : []));
  const lastActual = actualIdx.at(-1) ?? -1;
  const [bridgeIdx, setBridgeIdx] = useState(lastActual >= 1 ? lastActual : n - 1);

  const focus = groups.find((g) => g.key === focusKey) ?? null;
  const missing = (i: number) => months[i].filled === 0;
  const ytdLabel = actualIdx.length ? `${monthLabel(months[actualIdx[0]].ym)}~${monthLabel(months[lastActual].ym)} 실적` : '';
  const ytd = (list: Amounts[]) => sumAmounts(actualIdx.map((i) => list[i]));

  // ── 차트 데이터 (선택한 행 또는 전체) ──
  const src = focus ? focus.months : total;
  const chartRows = months.map((m, i) => {
    const x = metrics(src[i]);
    return {
      label: monthLabel(m.ym),
      fcst: m.kind === 'fcst',
      sales: x.sales,
      gpm: x.gpm == null ? null : x.gpm * 100,
      opm: x.opm == null || missing(i) ? null : x.opm * 100,
    };
  });
  const fcstRow = chartRows.find((r) => r.fcst);

  // ── 브리지 ──
  const wanted: AmountMetric = amountOf(metric);
  const bridgeBlocked = needsInput(wanted) && bridgeIdx >= 1 && (missing(bridgeIdx) || missing(bridgeIdx - 1));
  const bridgeMetric: AmountMetric = bridgeBlocked ? 'gp' : wanted;
  const steps = useMemo(() => buildBridge(groups, bridgeIdx, bridgeMetric), [groups, bridgeIdx, bridgeMetric]);
  const bridgeRows = steps.map((s) => ({ ...s, range: [Math.min(s.from, s.to), Math.max(s.from, s.to)] }));

  // ── 히트맵 ──
  const cellValue = (a: Amounts, i: number | 'ytd') => {
    if (needsInput(metric) && i !== 'ytd' && missing(i)) return null;
    return metricValue(a, metric);
  };
  const cap = useMemo(
    () =>
      capOf(
        groups.flatMap((g) =>
          g.months.map((a, i) => cellValue(a, i)).filter((v): v is number => v != null),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, metric, months],
  );
  const diverging = metric !== 'sales';
  const ytdMissing = needsInput(metric) && actualIdx.some(missing);

  const setAxis = (a: Axis) => {
    setFocusKey(null);
    startNav(() => router.push(`/trend?axis=${a}${ym ? `&ym=${ym}` : ''}`, { scroll: false }));
  };

  const scopeLabel = focus ? focus.label : '전체';

  return (
    <div className={`space-y-4 transition-opacity duration-200 ${navPending ? 'opacity-50' : ''}`}>
      {/* 필터: 화면 전체에 적용 */}
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-muted">분석 축</span>
          <select
            value={axis}
            onChange={(e) => setAxis(e.target.value as Axis)}
            className="rounded-md border border-border bg-surface px-2 py-1.5"
          >
            {axes.map((a) => (
              <option key={a} value={a}>
                {AXIS_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex max-w-full overflow-x-auto rounded-md border border-border" role="group" aria-label="표 지표">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 ${metric === m ? 'bg-accent text-white' : 'hover:bg-surface-2'}`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        {focus && (
          <button
            type="button"
            onClick={() => setFocusKey(null)}
            className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent hover:opacity-80"
          >
            차트 범위: {focus.label} ✕
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          {data.dataDate && `데이터 기준일 ${dateLabel(data.dataDate)} · `}마감월 = CO-PA 실적, {monthLabel(months[n - 1].ym)} = 월 예상
        </span>
      </div>

      <AnalysisTabs label="월별 분석 보기" tabs={[
      { label: '매출·이익률', content: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card px-4 py-3">
          <h2 className="text-sm font-bold">월별 매출 · {scopeLabel}</h2>
          <p className="mb-2 text-xs text-muted">단위: 억원. 연한 막대는 진행 중인 달의 월 예상</p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} />
                <YAxis tickFormatter={(v) => eokTick(Number(v))} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  formatter={(v) => [`${eokNum(Number(v))}억`, '매출']}
                  labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.fcst ? ' (월 예상)' : ''}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--border)' }}
                />
                <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={36} animationDuration={ANIM}>
                  {chartRows.map((r) => (
                    <Cell
                      key={r.label}
                      fill="var(--viz-1)"
                      fillOpacity={r.fcst ? 0.35 : 1}
                      stroke={r.fcst ? 'var(--viz-1)' : undefined}
                      strokeDasharray={r.fcst ? '4 3' : undefined}
                    />
                  ))}
                  <LabelList
                    dataKey="sales"
                    content={(p) => {
                      const { x, y, width, index } = p as { x: number; y: number; width: number; index: number };
                      if (!chartRows[index]?.fcst) return null;
                      return (
                        <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--text)">
                          예상 {eokNum(chartRows[index].sales)}억
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card px-4 py-3">
          <h2 className="text-sm font-bold">월별 이익률 · {scopeLabel}</h2>
          <p className="mb-2 text-xs text-muted">
            단위: %. 장려금·일반비를 입력하지 않은 달은 영업이익률을 그리지 않습니다
            {fcstRow ? ` · ${fcstRow.label}은 예상` : ''}
          </p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} />
                <YAxis tickFormatter={(v) => minus(String(v))} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <ReferenceLine y={0} stroke="var(--viz-axis)" />
                <Tooltip
                  formatter={(v, name) => [v == null ? '미입력' : `${minus(Number(v).toFixed(1))}%`, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--border)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  dataKey="gpm"
                  name="매출이익률"
                  stroke="var(--viz-1)"
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--viz-1)' }}
                  activeDot={{ r: 5 }}
                  animationDuration={ANIM}
                />
                <Line
                  dataKey="opm"
                  name="영업이익률"
                  stroke="var(--viz-2)"
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--viz-2)' }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  animationDuration={ANIM}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      ) },
      { label: '전월 대비 변동', content: (
      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold">
            전월 대비 {METRIC_LABEL[bridgeMetric]} 차이 · {AXIS_LABEL[axis]}별
          </h2>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted">기준월</span>
            <select
              value={bridgeIdx}
              onChange={(e) => setBridgeIdx(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1"
            >
              {months.map((m, i) =>
                i === 0 ? null : (
                  <option key={m.ym} value={i}>
                    {monthLabel(m.ym)}
                    {m.kind === 'fcst' ? ' 예상' : ''} vs {monthLabel(months[i - 1].ym)}
                  </option>
                ),
              )}
            </select>
          </label>
          <span className="text-xs text-muted">
            파랑: 증가 · 빨강: 감소 · 회색: 전체 증감 / 상위 8개 외 기타 합산 (억원)
          </span>
        </div>
        {bridgeBlocked && (
          <p className="mt-2 rounded bg-[var(--warn-bg)] px-3 py-1.5 text-xs text-[var(--warn-text)]">
            {monthLabel(months[bridgeIdx - 1].ym)}·{monthLabel(months[bridgeIdx].ym)} 중 장려금·일반비 미입력 달이 있어 영업이익 대신
            매출이익 차이를 보여줍니다.
          </p>
        )}
        {n < 2 ? (
          <p className="py-8 text-center text-sm text-muted">비교할 전월이 없습니다.</p>
        ) : (
          <div style={{ height: bridgeRows.length * 30 + 40 }} className="mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bridgeRows} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 8 }} barCategoryGap={4}>
                <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => eokNum(Number(v))} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  tick={{ fontSize: 12, fill: 'var(--text)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <ReferenceLine x={0} stroke="var(--viz-axis)" />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  formatter={(_v, _n, p) => [signedEok(p.payload.delta), p.payload.total ? '전체 차이' : '차이']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--border)' }}
                />
                <Bar dataKey="range" radius={2} animationDuration={ANIM}>
                  {bridgeRows.map((s) => (
                    <Cell
                      key={s.key}
                      fill={s.total ? 'var(--viz-total)' : s.delta >= 0 ? 'var(--viz-1)' : 'var(--viz-down)'}
                      fillOpacity={focusKey && !s.total && s.key !== focusKey ? 0.35 : 1}
                    />
                  ))}
                  <LabelList
                    dataKey="delta"
                    content={(p) => {
                      const { x, y, width, height, value } = p as { x: number; y: number; width: number; height: number; value: number };
                      const neg = Number(value) < 0;
                      return (
                        <text
                          x={neg ? x - 4 : x + width + 4}
                          y={y + height / 2}
                          dy={4}
                          textAnchor={neg ? 'end' : 'start'}
                          fontSize={11}
                          fill="var(--text)"
                        >
                          {signedEok(Number(value))}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      ) },
      { label: '계층별 월간 현황', content: (
      <section className="card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold">
            {AXIS_LABEL[axis]} × 월 · {METRIC_LABEL[metric]}
          </h2>
          <span className="text-xs text-muted">
            {isRate(metric) ? '단위: %' : '단위: 백만원'} · 계층 선택 시 차트 범위 변경 · 월 선택 시 변동 분석 기준월 변경
          </span>
          <HeatLegend diverging={diverging} cap={cap} metric={metric} />
        </div>
        <details className="method-note heat-guide">
          <summary>이 표 읽는 법</summary>
          <p>
            칸 하나 = 그 {AXIS_LABEL[axis]}의 그 달 {METRIC_LABEL[metric]} 값입니다. 색은 값 자체의 크기입니다 — 파랑이 진할수록 크고(이익·이익률이 높음),
            {diverging ? ' 빨강이 진할수록 손실이 큽니다(0 미만).' : ' 연할수록 작습니다.'} 극단값 하나가 색을 흐리지 않도록 상위 10% 값부터는 같은 가장 진한 색입니다.
            ① 가로로 읽으면 한 {AXIS_LABEL[axis]}의 월별 흐름(색이 진해지면 개선, 연해지거나 빨개지면 악화), ② 세로로 읽으면 같은 달 {AXIS_LABEL[axis]}끼리 비교입니다.
            행 이름을 누르면 위 차트가 그 행으로 바뀌고, 월 머리글을 누르면 ‘전월 대비 변동’의 기준월이 바뀝니다. 마지막 달은 월말 예상입니다.
          </p>
        </details>
        <div className="data-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] text-left">{AXIS_LABEL[axis]}</th>
                {months.map((m, i) => (
                  <th key={m.ym} className="num">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => setBridgeIdx(i)}
                      className={`leading-tight ${i === bridgeIdx ? 'text-accent underline underline-offset-4' : ''} ${i === 0 ? 'cursor-default' : 'hover:text-text'}`}
                      title={i === 0 ? undefined : '브리지 기준월로 보기'}
                    >
                      {monthLabel(m.ym)}
                      {m.kind === 'fcst' && <span className="ml-0.5 text-[10px]">예상</span>}
                      {m.costEst && <span className="ml-0.5 text-[10px] text-neg" title="원가 결산 전이라 3개월 평균 단위원가로 추정한 원가">원가추정</span>}
                      {needsInput(metric) && (
                        <span className={`block text-[10px] font-normal ${m.filled ? '' : 'text-neg'}`}>
                          {m.ledger ? 'SAP 원장' : m.filled ? `입력 ${m.filled}/${m.chTotal}` : '미입력'}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
                {ytdLabel && <th className="num border-l border-border">{ytdLabel}</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="total">
                <td className="sticky left-0 z-[1]">합계</td>
                {total.map((a, i) => (
                  <td key={i} className={`num ${months[i].kind === 'fcst' ? 'italic' : ''}`}>
                    {fmtCell(cellValue(a, i), metric)}
                  </td>
                ))}
                {ytdLabel && (
                  <td className="num border-l border-border">{ytdMissing ? '-' : fmtCell(metricValue(ytd(total), metric), metric)}</td>
                )}
              </tr>
              {groups.map((g) => {
                const sel = g.key === focusKey;
                return (
                  <tr key={g.key} className={sel ? 'outline outline-2 -outline-offset-2 outline-[var(--accent)]' : ''}>
                    <td className="sticky left-0 z-[1] max-w-[240px] bg-surface">
                      <button
                        type="button"
                        onClick={() => setFocusKey(sel ? null : g.key)}
                        aria-pressed={sel}
                        title={`${g.label} (${g.key})`}
                        className={`block w-full truncate text-left ${sel ? 'font-semibold text-accent' : 'hover:text-accent'}`}
                      >
                        {g.label}
                      </button>
                    </td>
                    {g.months.map((a, i) => {
                      const v = cellValue(a, i);
                      const h = heat(v, cap, diverging);
                      const blank = needsInput(metric) && missing(i);
                      return (
                        <td
                          key={i}
                          className={`num ${months[i].kind === 'fcst' ? 'italic' : ''} ${blank ? 'text-muted' : ''}`}
                          style={{ backgroundColor: h.bg, color: h.fg }}
                          title={`${g.label} · ${monthLabel(months[i].ym)}${months[i].kind === 'fcst' ? ' 예상' : ''} · ${METRIC_LABEL[metric]} ${fmtCell(v, metric)}`}
                        >
                          {blank ? '·' : fmtCell(v, metric)}
                        </td>
                      );
                    })}
                    {ytdLabel && (
                      <td className="num border-l border-border">
                        {ytdMissing ? '-' : fmtCell(metricValue(ytd(g.months), metric), metric)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) },
      ]} />
    </div>
  );
}

function HeatLegend({ diverging, cap, metric }: { diverging: boolean; cap: number; metric: TrendMetric }) {
  if (!cap) return null;
  const label = (v: number) => (isRate(metric) ? pct(v, 0) : mil(v));
  const swatches = diverging ? [...RED].reverse().concat(['var(--viz-mid)'], BLUE) : BLUE;
  return (
    <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted" aria-hidden>
      <span>{diverging ? `−${label(cap)}` : '0'}</span>
      <span className="flex overflow-hidden rounded-sm">
        {swatches.map((c, i) => (
          <span key={i} className="block h-2.5 w-3.5" style={{ backgroundColor: c }} />
        ))}
      </span>
      <span>
        {label(cap)}
        {'+'}
      </span>
    </div>
  );
}
