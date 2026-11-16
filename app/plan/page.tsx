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
        <p>제품계층 LV3별 판매계획과 실적·월 예상을 비교합니다. 계획이 LV3 단위라 분석도 LV3까지입니다(제품·채널로는 나누지 않음).</p>
        <details className="method-note">
          <summary>계산 기준</summary>
          <p>
            계획은 구글 시트 plan_lv3 탭(행 = 제품계층 LV3, 열 = 월, 매출 금액)에 직접 입력합니다(‘비용·계획 입력 › 판매계획’에서 시트 열기). 매출은 총매출(장려금 차감 전)입니다. 달성률 = 계획이 있는 LV3의
            실적 ÷ 계획 — 계획이 없는 LV3 매출은 분자에서 빼고 ‘계획 미수립 LV3 매출’로 따로 보여 줍니다. 당월 누계는 월 계획 × 월 진행률과, 당월 추세(누계 × 진행일 배수)는 월 계획 전체와, 전월 실적은 전월 계획과
            비교합니다. 경영 요약·손익 분석의 ‘당월 예상’은 계획을 넣은 LV3를 계획 금액으로 바꾸지만, 여기서는 계획과 견줄 수 있게 추세를 씁니다. 매출이 없는 계획 LV3는 코드 앞자리(LV1 3자리·LV2 8자리)로 상위 계층에 붙입니다.
          </p>
        </details>
      </div>
      <PlanView rows={rows} curYm={d.curYm} prevYm={d.prevYm} progressRate={d.progress.rate} plans={{ cur: planMapOf(plans, d.curYm), prev: planMapOf(plans, d.prevYm) }} />
    </div>
  );
}
