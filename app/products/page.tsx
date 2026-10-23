import Notices from '@/components/notices';
import ProductTable from '@/components/product-table';
import { getDashboard } from '@/lib/data';
import { ORPHAN_NAME } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const d = await getDashboard();
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>제품별 매출</h1>
        <p>제품별 매출과 판매단가를 비교합니다. ‘전체 지표’에서 상세 손익과 하위 제품계층을 확인할 수 있습니다.</p>
        <details className="method-note"><summary>단가 및 비용 배부 기준</summary><p>판매단가 = 제품별 매출 ÷ 판매수량(EA). 월 예상 단가는 누계와 동일합니다. 장려금·일반비는 제품계층 LV1 입력값을 해당 제품의 매출 비중으로 배부합니다.</p></details>
      </div>
      <Notices d={d} />
      <ProductTable rows={d.rows.filter((r) => r.name !== ORPHAN_NAME)} curYm={d.curYm} prevYm={d.prevYm} />
    </div>
  );
}
