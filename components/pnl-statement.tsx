import { growth, mil, pct, ppt, signedMil, tone } from '@/lib/format';
import { metrics, type Metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts, DashboardData } from '@/lib/types';

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
  inputStatus,
}: {
  total: { mtd: Amounts; fcst: Amounts; prev: Amounts };
  curYm: string;
  prevYm: string;
  inputStatus: DashboardData['inputStatus'];
}) {
  const mtd = metrics(total.mtd);
  const fcst = metrics(total.fcst);
  const prev = metrics(total.prev);
  return (
    <section className="card statement-panel">
      <div className="panel-heading">
        <div><h2>손익 요약</h2><p>당월 예상과 전월 실적 비교</p></div>
        <span className="unit-label">백만원 · %</span>
      </div>
      <div className="statement-table overflow-x-auto">
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
              <tr key={l.label} className={l.strong ? 'statement-key' : l.rate ? 'statement-rate text-muted' : ''}>
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
      <div className="panel-footer"><span>{inputStatus.curFilled < inputStatus.l1Total ? `장려금·일반비 ${inputStatus.curFilled}/${inputStatus.l1Total}개 계층 반영` : '장려금·일반비 입력 완료'}</span><span>전월 대비: 월 전체 기준</span></div>
    </section>
  );
}
