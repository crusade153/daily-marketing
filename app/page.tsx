import KpiCards from '@/components/kpi-cards';
import Notices from '@/components/notices';
import PeriodBar from '@/components/period-bar';
import AnalysisTabs from '@/components/analysis-tabs';
import CategoryOverview from '@/components/category-overview';
import PnlStatement from '@/components/pnl-statement';
import PriceTrend from '@/components/price-trend';
import { getDashboard, getPriceTrend } from '@/lib/data';
import { groupBy, metrics, totalOf } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export default async function SummaryPage() {
  const [d, price] = await Promise.all([getDashboard(), getPriceTrend()]);
  const total = totalOf(d.rows);
  return (
    <div className="summary-page">
      <PeriodBar d={d} />
      <Notices d={d} />
      <AnalysisTabs label="요약 분석" tabs={[
        { label: '손익 현황', content: <div className="overview-content">
          <KpiCards total={total} curYm={d.curYm} prevYm={d.prevYm} inputStatus={d.inputStatus} />
          <div className="summary-panels">
          <PnlStatement total={total} curYm={d.curYm} prevYm={d.prevYm} inputStatus={d.inputStatus} />
          <CategoryOverview categories={groupBy(d.rows, 'l1').map((g) => {
            const m = metrics(g.fcst);
            return { key: g.key, label: g.label, sales: m.sales, gp: m.gp, gpm: m.gpm };
          })} />
          </div>
        </div> },
        { label: '판매단가 분석', content: <PriceTrend trend={price} /> },
      ]} />
      <p className="summary-footnote">당월은 월말 예상, 전월은 마감 실적 기준입니다. 장려금·일반비 입력 현황에 따라 영업이익이 달라질 수 있습니다.</p>
    </div>
  );
}
