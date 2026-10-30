import { eok, pct, ppt, signedEok, tone } from '@/lib/format';
import { metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts, DashboardData } from '@/lib/types';

function Card({
  title,
  main,
  sub,
  rows,
  emphasis = false,
}: {
  title: string;
  main: string;
  sub?: React.ReactNode;
  rows: [string, string][];
  emphasis?: boolean;
}) {
  return (
    <div className={`card kpi-card ${emphasis ? 'kpi-primary' : ''}`}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{main}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      <dl className="kpi-comparison">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-muted">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function KpiCards({
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
  const m = metrics(total.mtd);
  const f = metrics(total.fcst);
  const p = metrics(total.prev);
  const cur = monthLabel(curYm);
  const prv = monthLabel(prevYm);
  const missing = inputStatus.curFilled === 0 && !inputStatus.curChannel;
  const prevMissing = inputStatus.prevFilled === 0 && !inputStatus.prevChannel;
  return (
    <section className="kpi-grid" aria-label="주요 경영지표">
      <Card
        emphasis
        title={`${cur} 예상 매출`}
        main={eok(f.sales)}
        sub={<span className={tone(f.sales - p.sales)}>전월 대비 {signedEok(f.sales - p.sales)}</span>}
        rows={[
          [`${cur} 누계`, eok(m.sales)],
          [`${prv} 실적`, eok(p.sales)],
        ]}
      />
      <Card
        title={`${cur} 예상 매출이익`}
        main={eok(f.gp)}
        sub={<span>매출이익률 {pct(f.gpm)} <span className={tone((f.gpm ?? 0) - (p.gpm ?? 0))}>({ppt(f.gpm, p.gpm)})</span></span>}
        rows={[
          [`${cur} 누계`, eok(m.gp)],
          [`${prv} 실적`, eok(p.gp)],
        ]}
      />
      <Card
        title={`${cur} 예상 장려금 + 일반비`}
        main={missing ? '입력 대기' : eok(f.incentive + f.general)}
        sub={<span className="text-muted">{missing ? '장려금·일반비 입력 후 반영' : `매출 대비 ${pct(f.sales ? (f.incentive + f.general) / f.sales : null)}`}</span>}
        rows={[
          ['장려금 / 일반비', missing ? '미입력' : `${eok(f.incentive)} / ${eok(f.general)}`],
          [`${prv} 실적`, prevMissing ? '미입력' : eok(p.incentive + p.general)],
        ]}
      />
      <Card
        title={`${cur} 예상 영업이익`}
        main={eok(f.op)}
        sub={<span>{missing ? '장려금·일반비 미반영' : inputStatus.curFilled < inputStatus.l1Total ? `일부 비용 미반영 · 이익률 ${pct(f.opm)}` : <>영업이익률 {pct(f.opm)} <span className={tone((f.opm ?? 0) - (p.opm ?? 0))}>({ppt(f.opm, p.opm)})</span></>}</span>}
        rows={[
          [`${cur} 누계`, eok(m.op)],
          [`${prv} 실적`, eok(p.op)],
        ]}
      />
    </section>
  );
}
