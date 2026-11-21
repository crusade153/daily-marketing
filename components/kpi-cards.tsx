import { costMissing } from '@/lib/cost-source';
import { eok, growth, pct, ppt, signedEok, tone } from '@/lib/format';
import { metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts, DashboardData } from '@/lib/types';

function Card({
  title,
  value,
  sub,
  note,
  emphasis = false,
}: {
  title: string;
  value: number;
  sub?: React.ReactNode;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <article className={`card kpi-card ${emphasis ? 'kpi-primary' : ''}`}>
      <h2 className="kpi-title">{title}</h2>
      <div className="kpi-value">{eok(value).slice(0, -1)}<span>억</span></div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {note && <p className="kpi-note">{note}</p>}
    </article>
  );
}

export default function KpiCards({
  total,
  curYm,
  inputStatus,
  planFcst = null,
}: {
  total: { fcst: Amounts; prev: Amounts };
  curYm: string;
  inputStatus: DashboardData['inputStatus'];
  /** 예상 매출에 반영한 판매계획 */
  planFcst?: DashboardData['planFcst'];
}) {
  const f = metrics(total.fcst);
  const p = metrics(total.prev);
  const cur = monthLabel(curYm);
  const missing = costMissing(inputStatus.cur);
  const partial = inputStatus.cur.source === 'manual' && (inputStatus.cur.sg < inputStatus.sgTotal || inputStatus.cur.ch < inputStatus.chTotal);
  const salesDiff = f.sales - p.sales;
  const salesGrowth = p.sales > 0 ? growth(f.sales, p.sales) : null;
  return (
    <section className="kpi-grid" aria-label={`${cur} 월말 예상 핵심 지표`}>
      <Card
        emphasis
        title="예상 총매출"
        value={f.sales}
        sub={<>전월 대비 <strong className={tone(salesDiff)}>{signedEok(salesDiff)}{salesGrowth != null && ` (${pct(salesGrowth)})`}</strong></>}
        note={planFcst?.lv3 ? `판매계획 반영 ${planFcst.lv3}개 · ${eok(planFcst.sales)}` : undefined}
      />
      <Card
        title="예상 순매출"
        value={f.net}
        sub={<span className={missing ? 'text-warn' : undefined}>{missing ? '장려금 미반영' : `차감 장려금 ${eok(f.incentive)}`}</span>}
      />
      <Card
        title="예상 매출총이익"
        value={f.gp}
        sub={<>이익률 <strong>{pct(f.gpm)}</strong>{f.gpm != null && p.gpm != null && <> · 전월 대비 <strong className={tone(f.gpm - p.gpm)}>{ppt(f.gpm, p.gpm)}</strong></>}</>}
      />
      <Card
        title="예상 영업이익"
        value={f.op}
        sub={<>이익률 <strong>{pct(f.opm)}</strong>{!missing && !partial && f.opm != null && p.opm != null && <> · 전월 대비 <strong className={tone(f.opm - p.opm)}>{ppt(f.opm, p.opm)}</strong></>}</>}
        note={missing ? '장려금·일반비 미반영' : partial ? '일부 영업그룹·채널 비용 미입력' : undefined}
      />
    </section>
  );
}
