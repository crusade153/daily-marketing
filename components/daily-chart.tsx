'use client';

import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { eok, growth, mil, pct, signedMil, tone } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { DailyFact } from '@/lib/types';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export default function DailyChart({
  daily,
  curYm,
  prevYm,
  daysInMonth,
  prevDays,
}: {
  daily: DailyFact[];
  curYm: string;
  prevYm: string;
  daysInMonth: number;
  prevDays: number;
}) {
  const l1s = useMemo(() => {
    const s = new Map<string, number>();
    for (const d of daily) s.set(d.l1t, (s.get(d.l1t) ?? 0) + d.sales);
    return [...s].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [daily]);
  const [l1, setL1] = useState('전체');

  const series = useMemo(() => {
    const cur = new Array(daysInMonth + 1).fill(0);
    const prev = new Array(prevDays + 1).fill(0);
    let lastDay = 0;
    for (const d of daily) {
      if (l1 !== '전체' && d.l1t !== l1) continue;
      const day = Number(d.date.slice(6, 8));
      if (d.date.startsWith(curYm)) {
        cur[day] += d.sales;
        lastDay = Math.max(lastDay, day);
      } else if (d.date.startsWith(prevYm)) prev[day] += d.sales;
    }
    const out = [];
    let cc = 0;
    let pc = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      cc += cur[day];
      if (day <= prevDays) pc += prev[day];
      const dow = new Date(Number(curYm.slice(0, 4)), Number(curYm.slice(4, 6)) - 1, day).getDay();
      out.push({
        day,
        label: `${day}`,
        dow: WEEK[dow],
        weekend: dow === 0 || dow === 6,
        sales: day <= lastDay ? cur[day] : null,
        cum: day <= lastDay ? cc : null,
        prevDaily: day <= prevDays ? prev[day] : null,
        prevCum: pc,
      });
    }
    return out;
  }, [daily, l1, curYm, prevYm, daysInMonth, prevDays]);

  const done = series.filter((s) => s.cum != null);
  const last = done[done.length - 1];
  const cur = monthLabel(curYm);
  const prv = monthLabel(prevYm);

  return (
    <div className="space-y-4">
      <div className="card px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <select value={l1} onChange={(e) => setL1(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1.5">
            <option>전체</option>
            {l1s.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          {last && (
            <span className="text-muted">
              {cur} {last.day}일 누계 <b className="text-text">{eok(last.cum ?? 0)}</b> · {prv} 같은 날까지{' '}
              <b className="text-text">{eok(last.prevCum)}</b>{' '}
              <span className={tone((last.cum ?? 0) - last.prevCum)}>
                ({last.prevCum > 0 ? pct(growth(last.cum ?? 0, last.prevCum)) : '-'})
              </span>
            </span>
          )}
          <span className="ml-auto text-xs text-muted">막대·선 단위: 백만원</span>
        </div>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              <YAxis
                yAxisId="d"
                tickFormatter={(v) => mil(v)}
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <YAxis
                yAxisId="c"
                orientation="right"
                tickFormatter={(v) => mil(v)}
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                formatter={(v, name) => [v == null ? '-' : `${mil(Number(v))} 백만원`, name]}
                labelFormatter={(l, p) => `${cur} ${l}일 (${p?.[0]?.payload?.dow ?? ''})`}
                contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--border)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="d" dataKey="sales" name={`${cur} 일매출`} fill="var(--bar-cur)" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Line yAxisId="c" dataKey="cum" name={`${cur} 누계`} stroke="var(--bar-cur)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line yAxisId="c" dataKey="prevCum" name={`${prv} 누계`} stroke="var(--bar-prev)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card max-h-[60vh] overflow-auto">
        <table className="dtable">
          <thead>
            <tr>
              <th className="text-left">일자</th>
              <th className="num">{cur} 일매출</th>
              <th className="num">{cur} 누계</th>
              <th className="num">{prv} 같은 날 일매출</th>
              <th className="num">{prv} 같은 날 누계</th>
              <th className="num">누계 차이</th>
            </tr>
          </thead>
          <tbody>
            {done.map((s) => (
              <tr key={s.day}>
                <td className={s.weekend ? 'text-muted' : ''}>
                  {s.day}일 ({s.dow})
                </td>
                <td className="num">{mil(s.sales ?? 0)}</td>
                <td className="num font-semibold">{mil(s.cum ?? 0)}</td>
                <td className="num text-muted">{s.prevDaily == null ? '-' : mil(s.prevDaily)}</td>
                <td className="num text-muted">{mil(s.prevCum)}</td>
                <td className={`num ${tone((s.cum ?? 0) - s.prevCum)}`}>{signedMil((s.cum ?? 0) - s.prevCum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
