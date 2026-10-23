import Notices from '@/components/notices';
import PnlPivot from '@/components/pnl-pivot';
import { getDashboard } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function HierarchyPage() {
  const d = await getDashboard();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">계층별 손익</h1>
        <p className="text-xs text-muted">
          기본은 제품계층 LV1 › LV2 › LV3 › LV4 순서로 펼쳐 봅니다. 1~4차 축은 CM·카테고리·담당자로 바꿀 수 있습니다. 장려금·일반비는
          제품계층 LV1로 입력한 월 금액을 그 안의 제품 매출 비중으로 나눠 붙여서, 어느 축으로 봐도 합계가 같습니다. 누계 기준은
          입력값 × 진행률입니다. 제품코드 단위는 제품별 매출 화면에서 봅니다.
        </p>
      </div>
      <Notices d={d} />
      <PnlPivot rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} exportHref="/hierarchy/export" />
    </div>
  );
}
