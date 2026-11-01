import Notices from '@/components/notices';
import SegmentView from '@/components/segment-view';
import MonthStepper from '@/components/month-stepper';
import { getDashboard, getSegment } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';

export const dynamic = 'force-dynamic';

export default async function SegmentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ch, ym } = await searchParams;
  const channel = typeof ch === 'string' && ch ? ch : null;
  const sel = await pageMonth(ym);
  const [d, s] = await Promise.all([getDashboard(sel.today), getSegment(channel, sel.today)]);
  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h1>ABCD 등급관리</h1>
        <MonthStepper {...monthLinks('/segment', sel, { ch: channel })} />
        <p>CM · PM · 제품 · 채널로 범위를 좁혀 제품이 A~D 중 어느 등급에 놓이는지 확인합니다. 기준 지표와 기준선을 바꿔 등급을 시뮬레이션하고, 주요 품목 리스트로 매출·이익을 이끄는 제품을 추립니다.</p>
        <details className="method-note">
          <summary>등급 및 주요 품목 기준</summary>
          <p>
            A 핵심품목 = X↑·Y↑, B 수익개선품목 = X↑·Y↓, C 육성품목 = X↓·Y↑, D 지속여부 검토 품목 = X↓·Y↓ (기준선 이상이면 ↑). 기본 기준(순매출 5천만원 × 영업이익 0)에서는 A·C가 손익+, B·D가 손익−입니다. 색은 신호등 순서로 A 초록 &gt; C 노랑 &gt; B 주황 &gt; D 빨강이며, 등급 변동은 이 순서로 내려가면 악화, 올라가면 개선입니다. 기준선은 선택한 범위 안에서 다시 계산하므로, 범위를 좁히면 같은 제품의 등급이 바뀔 수 있습니다.
            채널을 고르면 그 고객그룹3의 매출·원가·장려금·일반비만으로 다시 계산합니다. 순매출 = 총매출 − 장려금, 매출총이익 = 순매출 − 매출원가, 영업이익 = 매출총이익 − 일반비, 이익률은 순매출 대비입니다.
            ‘상위 누적 비중’ 기준선은 큰 순으로 더해 선택 비중(예: 80%)에 처음 닿는 값입니다. 주요 품목의 중요도는 같은 방식으로 누적 80%까지 핵심, 95%까지 중요, 나머지 일반입니다. 이익률·성장률의 평균은 합계 기준 가중평균입니다. 기간에 실적이 없는 제품은 제외합니다.
          </p>
        </details>
      </div>
      <Notices d={d} />
      <SegmentView key={`${channel ?? 'all'}-${sel.ym}`} products={s.products} periods={s.periods} channels={s.channels} channel={s.channel} monthYm={sel.ym} />
    </div>
  );
}
