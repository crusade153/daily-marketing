import { growth, mil, pct, ppt, signedMil, tone } from '@/lib/format';
import { metrics, type Metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts } from '@/lib/types';

type Line = { label: string; get: (m: Metrics) => number | null; rate?: boolean; strong?: boolean; cost?: boolean };

const LINES: Line[] = [
  { label: '매출', get: (m) => m.sales, strong: true },
  { label: '매출원가', get: (m) => m.cogs, cost: true },
  { label: '매출이익', get: (m) => m.gp, strong: true },
  { label: '매출이익률', get: (m) => m.gpm, rate: true },
  { label: '장려금', get: (m) => m.incentive, cost: true },
  { label: '일반비', get: (m) => m.general, cost: true },
  { label: '영업이익', get: (m) => m.op, strong: true },
  { label: '영업이익률', get: (m) => m.opm, rate: true },
];

/** 손익계산서 형태: 당월 누계 | 당월 예상 | 전월 실적 | 예상−전월 (단위: 백만원) */
export default function PnlStatement({
  total,
  curYm,
  prevYm,
}: {
  total: { mtd: Amounts; fcst: Amounts; prev: Amounts };
  curYm: string;
  prevYm: string;
}) {
  const mtd = metrics(total.mtd);
  const fcst = metrics(total.fcst);
  const prev = metrics(total.prev);
  return (
    <div className="card overflow-x-auto">
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
        <h2 className="text-sm font-bold">손익 요약</h2>
        <span className="text-xs text-muted">단위: 백만원</span>
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <th className="text-left">항목</th>
            <th className="num">{monthLabel(curYm)} 누계</th>
            <th className="num">{monthLabel(curYm)} 예상</th>
            <th className="num">{monthLabel(prevYm)} 실적</th>
            <th className="num">예상 − 전월</th>
            <th className="num">증감률</th>
          </tr>
        </thead>
        <tbody>
          {LINES.map((l) => {
            const a = l.get(mtd);
            const f = l.get(fcst);
            const p = l.get(prev);
            const fmt = (v: number | null) => (l.rate ? pct(v) : v == null ? '-' : mil(v));
            const diff = l.rate ? ppt(f, p) : f != null && p != null ? signedMil(f - p) : '-';
            const diffNum = f != null && p != null ? (l.cost ? p - f : f - p) : null;
            return (
              <tr key={l.label} className={l.strong ? 'font-semibold' : l.rate ? 'text-muted' : ''}>
                <td className={l.rate ? 'pl-6' : ''}>{l.label}</td>
                <td className="num">{fmt(a)}</td>
                <td className="num bg-accent-soft/40">{fmt(f)}</td>
                <td className="num">{fmt(p)}</td>
                <td className={`num ${tone(diffNum)}`}>{diff}</td>
                <td className="num text-muted">{l.rate || f == null || p == null || p <= 0 ? '' : pct(growth(f, p))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
