import Notices from '@/components/notices';
import PnlPivot from '@/components/pnl-pivot';
import MonthStepper from '@/components/month-stepper';
import { getDashboard } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sel = await pageMonth((await searchParams).ym);
  const d = await getDashboard(sel.today);
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>채널별 손익 분석</h1>
        <MonthStepper {...monthLinks('/channels', sel)} />
      </div>
      <Notices d={d} />
      <PnlPivot mode="channel" rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} progressRate={d.progress.rate} />
    </div>
  );
}
