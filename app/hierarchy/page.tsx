import Notices from '@/components/notices';
import PnlExplorer from '@/components/pnl-explorer';
import { getDashboard } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ view }, d] = await Promise.all([searchParams, getDashboard()]);
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>손익 분석</h1>
        <p>CM·PM·제품라인·품목·브랜드 순으로 손익을 좁혀 봅니다. 제품 목록에서는 제품별 판매단가까지 확인합니다.</p>
        <details className="method-note"><summary>비용 배부·단가 기준</summary><p>장려금·일반비는 제품계층 LV1(브랜드) 입력 금액을 제품별 매출 비중으로 배부합니다. 분석 축과 관계없이 합계는 동일하며, 누계에는 월 입력값 × 월 진행률을 적용합니다. 판매단가 = 제품별 매출 ÷ 판매수량(EA). 전월비는 매출은 증감률, GP·OP는 이익률 차이(%p)입니다.</p></details>
      </div>
      <Notices d={d} />
      <PnlExplorer rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} initialView={view === 'product' ? 'product' : 'pivot'} />
    </div>
  );
}
