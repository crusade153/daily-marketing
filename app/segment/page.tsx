import Notices from '@/components/notices';
import SegmentView from '@/components/segment-view';
import MonthStepper from '@/components/month-stepper';
import { getDashboard, getSegment } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';

export const dynamic = 'force-dynamic';

export default async function SegmentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ch, ym } = await searchParams;
  const channel = typeof ch === 'string' && ch ? ch : null;
  const sel = await pageMonth(ym);
  const [d, s] = await Promise.all([getDashboard(sel.today), getSegment(channel, sel.today)]);
  return (
    <div className="report-page">
      <div className="page-intro">
        <h1>ABCD 등급관리</h1>
        <MonthStepper {...monthLinks('/segment', sel, { ch: channel })} />
      </div>
      <Notices d={d} />
      <SegmentView key={`${channel ?? 'all'}-${sel.ym}`} products={s.products} periods={s.periods} channels={s.channels} channel={s.channel} monthYm={sel.ym} />
    </div>
  );
}
