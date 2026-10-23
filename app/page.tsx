import KpiCards from '@/components/kpi-cards';
import Notices from '@/components/notices';
import PeriodBar from '@/components/period-bar';
import PnlPivot from '@/components/pnl-pivot';
import PnlStatement from '@/components/pnl-statement';
import PriceTrend from '@/components/price-trend';
import { getDashboard, getPriceTrend } from '@/lib/data';
import { totalOf } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export default async function SummaryPage() {
  const [d, price] = await Promise.all([getDashboard(), getPriceTrend()]);
  const total = totalOf(d.rows);
  return (
    <div className="space-y-4">
      <PeriodBar d={d} />
      <Notices d={d} />
      <KpiCards total={total} curYm={d.curYm} prevYm={d.prevYm} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PnlStatement total={total} curYm={d.curYm} prevYm={d.prevYm} />
        <div>
          <h2 className="mb-2 text-sm font-bold">제품계층별 (당월 예상, 누르면 LV2 › LV3 › LV4)</h2>
          <PnlPivot rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} controls={false} />
        </div>
      </div>
      <PriceTrend trend={price} />
    </div>
  );
}
