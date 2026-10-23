import { eok, pct, ppt, signedEok, tone } from '@/lib/format';
import { metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts } from '@/lib/types';

function Card({
  title,
  main,
  sub,
  rows,
}: {
  title: string;
  main: string;
  sub?: React.ReactNode;
  rows: [string, string][];
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs font-semibold text-muted">{title}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight num text-left">{main}</div>
      {sub && <div className="mt-0.5 text-xs">{sub}</div>}
      <dl className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
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
}: {
  total: { mtd: Amounts; fcst: Amounts; prev: Amounts };
  curYm: string;
  prevYm: string;
}) {
  const m = metrics(total.mtd);
  const f = metrics(total.fcst);
  const p = metrics(total.prev);
  const cur = monthLabel(curYm);
  const prv = monthLabel(prevYm);
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
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
          [`${cur} 누계`, `${eok(m.gp)} · ${pct(m.gpm)}`],
          [`${prv} 실적`, `${eok(p.gp)} · ${pct(p.gpm)}`],
        ]}
      />
      <Card
        title={`${cur} 예상 장려금 + 일반비`}
        main={eok(f.incentive + f.general)}
        sub={<span className="text-muted">매출 대비 {pct(f.sales ? (f.incentive + f.general) / f.sales : null)}</span>}
        rows={[
          ['장려금 / 일반비', `${eok(f.incentive)} / ${eok(f.general)}`],
          [`${prv} 실적`, eok(p.incentive + p.general)],
        ]}
      />
      <Card
        title={`${cur} 예상 영업이익`}
        main={eok(f.op)}
        sub={<span>영업이익률 {pct(f.opm)} <span className={tone((f.opm ?? 0) - (p.opm ?? 0))}>({ppt(f.opm, p.opm)})</span></span>}
        rows={[
          [`${cur} 누계`, `${eok(m.op)} · ${pct(m.opm)}`],
          [`${prv} 실적`, `${eok(p.op)} · ${pct(p.opm)}`],
        ]}
      />
    </section>
  );
}
