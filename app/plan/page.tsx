import MonthStepper from '@/components/month-stepper';
import PlanView from '@/components/plan-view';
import { getDashboard, getPlans } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';
import { planMapOf, type PlanSourceRow } from '@/lib/plan';
import { forecastFactor, ORPHAN_NAME } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ym } = await searchParams;
  const sel = await pageMonth(ym);
  const [d, plans] = await Promise.all([getDashboard(sel.today), getPlans()]);
  // 계획 비교에 필요한 값만 넘긴다 (제품 × 채널 행 → 계층·매출).
  // 대시보드 예상은 계획을 넣은 LV3를 계획 금액으로 바꾸므로, 여기서는 계획과 비교할 수 있게 누계 추세(누계 × 진행일 배수)를 쓴다
  const k = d.progress.elapsed < d.progress.daysInMonth ? forecastFactor(d.progress.elapsed, d.progress.daysInMonth) : 1;
  const rows: PlanSourceRow[] = d.rows
    .filter((r) => r.name !== ORPHAN_NAME)
    .map((r) => ({
      l1: r.l1,
      l1t: r.l1t,
      l2: r.l2,
      l2t: r.l2t,
      l3: r.l3,
      l3t: r.l3t,
      mtd: r.mtd.sales,
      fcst: d.progress.elapsed < d.progress.daysInMonth ? r.mtd.sales * k : r.fcst.sales,
      prev: r.prev.sales,
    }));
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>판매계획 대비</h1>
        <MonthStepper {...monthLinks('/plan', sel)} />
      </div>
      <PlanView rows={rows} curYm={d.curYm} prevYm={d.prevYm} progressRate={d.progress.rate} plans={{ cur: planMapOf(plans, d.curYm), prev: planMapOf(plans, d.prevYm) }} />
    </div>
  );
}
