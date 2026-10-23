import Notices from '@/components/notices';
import ProductTable from '@/components/product-table';
import { getDashboard } from '@/lib/data';
import { ORPHAN_NAME } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const d = await getDashboard();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">제품별 매출</h1>
        <p className="text-xs text-muted">
          제품코드 단위 손익입니다. 판매단가는 제품별 매출 ÷ 판매수량(EA)이고, 예상 보기의 단가는 누계와 같습니다. 장려금·일반비는
          제품계층 LV1 입력값을 이 제품의 매출 비중만큼 배부한 금액입니다.
        </p>
      </div>
      <Notices d={d} />
      <ProductTable rows={d.rows.filter((r) => r.name !== ORPHAN_NAME)} curYm={d.curYm} prevYm={d.prevYm} />
    </div>
  );
}
