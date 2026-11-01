import KpiCards from '@/components/kpi-cards';
import Notices from '@/components/notices';
import PeriodBar from '@/components/period-bar';
import AnalysisTabs from '@/components/analysis-tabs';
import CategoryOverview from '@/components/category-overview';
import PnlStatement from '@/components/pnl-statement';
import PriceTrend from '@/components/price-trend';
import { getDashboard, getPriceTrend } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';
import { groupBy, metrics, sortGroups, totalOf, type Axis } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

/** 실적 전망 패널 기준: ① CM ② 브랜드 ③ 채널 (사용자 요청 순서) */
const OVERVIEW_AXES: { id: Axis; label: string }[] = [
  { id: 'cm', label: 'CM' },
  { id: 'l1', label: '브랜드' },
  { id: 'ch', label: '채널' },
];

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sel = await pageMonth((await searchParams).ym);
  const [d, price] = await Promise.all([getDashboard(sel.today), getPriceTrend(sel.today)]);
  const total = totalOf(d.rows);
  return (
    <div className="summary-page">
      <PeriodBar d={d} nav={monthLinks('/', sel)} />
      <Notices d={d} />
      <AnalysisTabs label="요약 분석" tabs={[
        { label: '손익 현황', content: <div className="overview-content">
          <KpiCards total={total} curYm={d.curYm} prevYm={d.prevYm} inputStatus={d.inputStatus} />
          <div className="summary-panels">
          <PnlStatement total={total} curYm={d.curYm} prevYm={d.prevYm} inputStatus={d.inputStatus} />
          <CategoryOverview views={OVERVIEW_AXES.map(({ id, label }) => ({
            id,
            label,
            // 서버에서 묶어 보내 화면 전달량을 줄인다
            fixedOrder: id === 'cm',
            categories: sortGroups(groupBy(d.rows, id), id, (g) => g.fcst.sales)
              .filter((g) => g.fcst.sales || g.fcst.cogs)
              .map((g) => {
                const m = metrics(g.fcst);
                return { key: g.key, label: g.label, sales: m.sales, gp: m.gp, gpm: m.gpm };
              }),
          }))} />
          </div>
        </div> },
        { label: '판매단가 분석', content: <PriceTrend trend={price} /> },
      ]} />
      <p className="summary-footnote">당월은 월말 예상, 전월은 마감 실적 기준입니다. 순매출 = 총매출 − 장려금, 이익률은 순매출 대비입니다. 장려금·일반비 입력 현황에 따라 매출총이익·영업이익이 달라질 수 있습니다.</p>
    </div>
  );
}
