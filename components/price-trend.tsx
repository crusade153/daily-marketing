'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tone, won } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { PriceTrend as Trend } from '@/lib/price';

const AXIS_TICK = { fontSize: 12, fill: 'var(--viz-axis)' };
const minus = (s: string) => s.replace('-', '−');
const signedPct = (r: number | null) => (r == null ? '-' : `${r > 0 ? '+' : ''}${minus((r * 100).toFixed(1))}%`);

/** 판매단가 추이: 동일제품 단가지수(믹스 제외) + 단순 평균단가 분해 */
export default function PriceTrend({ trend }: { trend: Trend }) {
  const [key, setKey] = useState('__all');
  const series = trend.series.find((s) => s.key === key) ?? trend.series[0];
  const { months } = trend;
  const first = months[0];

  const data = months.map((m, i) => ({
    label: monthLabel(m.ym),
    partial: m.partial,
    index: series.points[i].index,
  }));

  return (
    <section className="card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold">동일제품 판매단가 추이</h2>
        <select
          value={series.key}
          onChange={(e) => setKey(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          aria-label="제품계층 LV1"
        >
          {trend.series.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key === '__all' ? '전체' : s.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {first ? monthLabel(first.ym) : '첫 달'} = 100 · 제품 구성 변화를 제외한 단가 변동
        </span>
      </div>
      <div className="mt-4 price-layout">
        <div className="price-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} />
              <YAxis domain={['auto', 'auto']} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
              <ReferenceLine y={100} stroke="var(--viz-axis)" />
              <Tooltip
                formatter={(v) => [v == null ? '-' : Number(v).toFixed(1), '단가지수']}
                labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.partial ? ' (누계 기준)' : ''}`}
                contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--border)' }}
              />
              <Line
                dataKey="index"
                name="단가지수"
                stroke="var(--viz-1)"
                strokeWidth={2}
                connectNulls
                animationDuration={150}
                dot={(p) => {
                  const { cx, cy, index, payload } = p as { cx: number; cy: number; index: number; payload: { partial: boolean } };
                  if (cx == null || cy == null) return <g key={index} />;
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={4}
                      strokeWidth={2}
                      stroke={payload.partial ? 'var(--viz-1)' : 'var(--surface)'}
                      fill={payload.partial ? 'var(--surface)' : 'var(--viz-1)'}
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="price-table">
          <table className="dtable">
            <thead>
              <tr>
                <th className="text-left">월</th>
                <th className="num" title="동일제품 단가 변동 (믹스 제외)">
                  단가 변동
                </th>
                <th className="num" title="매출 ÷ 판매수량(EA), 전 제품">
                  평균단가(원)
                </th>
                <th className="num">평균단가 변동</th>
                <th className="num" title="평균단가 변동 중 단가 변동으로 설명되지 않는 부분">
                  믹스·기타
                </th>
                <th className="num" title="동일제품 비교에 들어간 매출 비중">
                  비교 매출 비중
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const p = series.points[i];
                return (
                  <tr key={m.ym}>
                    <td className="whitespace-nowrap">
                      {monthLabel(m.ym)}
                      {m.partial && <span className="ml-1 text-[10px] text-muted">누계</span>}
                    </td>
                    <td className={`num font-semibold ${tone(p.priceChg)}`}>{signedPct(p.priceChg)}</td>
                    <td className="num">{p.avgPrice == null ? '-' : won(p.avgPrice)}</td>
                    <td className={`num ${tone(p.avgChg)}`}>{signedPct(p.avgChg)}</td>
                    <td className={`num text-muted`}>{signedPct(p.mixChg)}</td>
                    <td className="num text-muted">{p.coverage == null ? '-' : `${(p.coverage * 100).toFixed(0)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <details className="method-note">
        <summary>지표 해석 및 비교 기준</summary>
        <p>동일제품 단가지수는 전월과 당월에 공통으로 판매된 제품의 단가 변동을 누적한 값입니다. 평균단가(매출 ÷ 판매수량 EA)의 변동은 단가 변동과 제품 구성(믹스)·기타 요인으로 구분합니다. 단가가 전월의 0.2배 미만 또는 5배 초과인 제품은 비교에서 제외하며, 당월은 누계 기준입니다.</p>
      </details>
    </section>
  );
}
