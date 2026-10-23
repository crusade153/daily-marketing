import Notices from '@/components/notices';
import PnlPivot from '@/components/pnl-pivot';
import { getDashboard } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function HierarchyPage() {
  const d = await getDashboard();
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>계층별 손익</h1>
        <p>제품계층·CM·담당자별 수익성을 비교합니다. 계층명을 선택하면 하위 단계가 표시됩니다.</p>
        <details className="method-note"><summary>비용 배부 기준</summary><p>장려금·일반비는 제품계층 LV1 입력 금액을 제품별 매출 비중으로 배부합니다. 분석 축과 관계없이 합계는 동일하며, 누계에는 월 입력값 × 월 진행률을 적용합니다. 제품코드별 내역은 ‘제품별 매출’에서 확인할 수 있습니다.</p></details>
      </div>
      <Notices d={d} />
      <PnlPivot rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} exportHref="/hierarchy/export" />
    </div>
  );
}
