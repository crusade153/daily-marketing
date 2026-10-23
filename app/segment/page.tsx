import Notices from '@/components/notices';
import SegmentView from '@/components/segment-view';
import { getDashboard, getSegment } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function SegmentPage() {
  const [d, s] = await Promise.all([getDashboard(), getSegment()]);
  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h1>ABCD 등급관리</h1>
        <p>제품계층 LV1~LV4를 차례로 좁혀 가며 제품이 A~D 중 어느 등급에 놓이는지 확인합니다. 기준 지표와 기준선을 바꿔 등급을 시뮬레이션하고, 주요 품목 리스트로 매출·이익을 이끄는 제품을 추립니다.</p>
        <details className="method-note">
          <summary>등급 및 주요 품목 기준</summary>
          <p>
            A 핵심 전략 = X↑·Y↑, B 수익 강소 = X↓·Y↑, C 수익 개선 = X↑·Y↓, D 재검토 = X↓·Y↓ (기준선 이상이면 ↑). 기준선은 선택한 계층 범위 안에서 다시 계산하므로, 계층을 좁히면 같은 제품의 등급이 바뀔 수 있습니다.
            ‘상위 누적 비중’ 기준선은 큰 순으로 더해 선택 비중(예: 80%)에 처음 닿는 값입니다. 주요 품목의 중요도는 같은 방식으로 누적 80%까지 핵심, 95%까지 중요, 나머지 일반입니다. 이익률·성장률의 평균은 합계 기준 가중평균입니다. 손익 계산(매출원가 추정, 장려금·일반비 배부)은 다른 화면과 같으며, 기간에 실적이 없는 제품은 제외합니다.
          </p>
        </details>
      </div>
      <Notices d={d} />
      <SegmentView products={s.products} periods={s.periods} />
    </div>
  );
}
