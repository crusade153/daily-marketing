import { sourceText } from '@/lib/cost-source';
import { growth, mil, pct, ppt, signedMil, tone } from '@/lib/format';
import { metrics, type Metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts, DashboardData } from '@/lib/types';

type Line = { label: string; get: (m: Metrics) => number | null; rate?: boolean; strong?: boolean; cost?: boolean; final?: boolean };

// 순매출 = 총매출 − 장려금, 매출총이익 = 순매출 − 매출원가, 영업이익 = 매출총이익 − 일반비. 이익률은 순매출 대비
const LINES: Line[] = [
  { label: '총매출', get: (m) => m.sales, strong: true },
  { label: '장려금', get: (m) => m.incentive, cost: true },
  { label: '순매출', get: (m) => m.net, strong: true },
  { label: '매출원가', get: (m) => m.cogs, cost: true },
  { label: '매출총이익', get: (m) => m.gp, strong: true },
  { label: 'GP율', get: (m) => m.gpm, rate: true },
  { label: '일반비', get: (m) => m.general, cost: true },
  { label: '영업이익', get: (m) => m.op, strong: true, final: true },
  { label: 'OP율', get: (m) => m.opm, rate: true },
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
    <section className="card statement-panel" aria-labelledby="statement-title">
      <div className="panel-heading">
        <h2 id="statement-title">손익 요약</h2>
        <span className="unit-label">백만원 · %</span>
      </div>
      <div className="statement-table overflow-x-auto" tabIndex={0} role="region" aria-label="손익 요약 표">
      <table className="dtable">
        <thead>
          <tr>
            <th className="text-left">항목</th>
            <th className="num">{monthLabel(curYm)} 누계</th>
            <th className="num">{monthLabel(curYm)} 예상</th>
            <th className="num">{monthLabel(prevYm)} 실적</th>
            <th className="num" title="당월 예상에서 전월 마감 실적을 뺀 금액">전월 차이</th>
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
              <tr key={l.label} className={l.final ? 'statement-final' : l.strong ? 'statement-key' : l.rate ? 'statement-rate text-muted' : ''}>
                <th scope="row" className="statement-label">{l.label}</th>
                <td className="num">{fmt(a)}</td>
                <td className="num bg-accent-soft/40">{fmt(f)}</td>
                <td className="num">{fmt(p)}</td>
                <td className={`num ${tone(diffNum)}`}>{diff}</td>
                <td className="num text-muted">{l.rate || f == null || p == null || p <= 0 ? '—' : pct(growth(f, p))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="panel-footer"><span>{sourceText(inputStatus.cur, inputStatus.sgTotal, inputStatus.chTotal)}</span><span>이익률은 순매출 기준</span></div>
    </section>
  );
}
