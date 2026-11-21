import Notices from '@/components/notices';
import PnlExplorer from '@/components/pnl-explorer';
import MonthStepper from '@/components/month-stepper';
import { getDashboard } from '@/lib/data';
import { monthHref, monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';

export const dynamic = 'force-dynamic';

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view, ym } = await searchParams;
  const sel = await pageMonth(ym);
  const d = await getDashboard(sel.today);
  const v = view === 'product' ? 'product' : null;
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>제품별 손익 분석</h1>
        <MonthStepper {...monthLinks('/hierarchy', sel, { view: v })} />
      </div>
      <Notices d={d} />
      <PnlExplorer
        rows={d.rows}
        curYm={d.curYm}
        prevYm={d.prevYm}
        progressRate={d.progress.rate}
        targets={d.targets}
        initialView={v ?? 'pivot'}
        exportHref={monthHref('/hierarchy/export', sel.ym)}
      />
    </div>
  );
}
