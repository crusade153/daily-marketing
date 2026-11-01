import Notices from '@/components/notices';
import PnlPivot from '@/components/pnl-pivot';
import MonthStepper from '@/components/month-stepper';
import { getDashboard } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sel = await pageMonth((await searchParams).ym);
  const d = await getDashboard(sel.today);
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>채널별 손익 분석</h1>
        <MonthStepper {...monthLinks('/channels', sel)} />
        <p>영업담당자 · 채널(고객그룹3) · 제품 순으로 매출, 매출총이익(GP), 영업이익(OP), 판가를 봅니다. 맨 위 등급 신호등에서 등급이 내려간 제품 × 채널부터 손볼 수 있습니다. 영업담당자는 ‘제품 매핑’에서 채널별로 입력합니다.</p>
        <details className="method-note"><summary>손익·배부·등급 기준</summary><p>순매출 = 총매출 − 장려금, 매출총이익(GP) = 순매출 − 매출원가, 영업이익(OP) = GP − 일반비, GP율·OP율은 순매출 대비입니다. 장려금·일반비 고정비는 고객그룹3별 입력 금액을 그 채널의 제품별 총매출 비중으로 배부하고, 일반비 변동비는 각 제품 총매출 × 채널 변동비율(%)입니다. 등급은 제품 × 채널마다 순매출 5천만원 이상(규모) × 영업이익 0 이상(손익+)으로 나눕니다(A 핵심 · B 수익개선 · C 육성 · D 지속여부 검토, ABCD 등급관리 기본 기준과 같음). 매출원가는 당월은 제품별 최근 3개월 단위원가 × 채널 판매수량, 전월은 CO-PA 실제원가입니다(원가 결산 전이면 당월과 같은 방식으로 추정). 판가는 총매출 ÷ 수량(묶음·합계는 수량 가중평균)이고, 판가 증감은 제품은 단가 증감, 묶음은 동일제품 단가 변동률입니다.</p></details>
      </div>
      <Notices d={d} />
      <PnlPivot mode="channel" rows={d.rows} curYm={d.curYm} prevYm={d.prevYm} progressRate={d.progress.rate} />
    </div>
  );
}
