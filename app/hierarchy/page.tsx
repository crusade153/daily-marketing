import Notices from '@/components/notices';
import PnlExplorer from '@/components/pnl-explorer';
import MonthStepper from '@/components/month-stepper';
import { getDashboard } from '@/lib/data';
import { monthHref, monthLinks, selectMonth } from '@/lib/month';

export const dynamic = 'force-dynamic';

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view, ym } = await searchParams;
  const sel = selectMonth(ym);
  const d = await getDashboard(sel.today);
  const v = view === 'product' ? 'product' : null;
  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>제품별 손익 분석</h1>
        <MonthStepper {...monthLinks('/hierarchy', sel, { view: v })} />
        <p>CM · PM · 제품라인 · 제품 순으로 목표 대비 실적을 좁혀 봅니다. 계층6에 채널을 넣으면 제품을 고객그룹3별로 나눠 봅니다.</p>
        <details className="method-note"><summary>손익·배부·목표 기준</summary><p>순매출 = 총매출 − 장려금, 매출총이익(GP) = 순매출 − 매출원가, 영업이익(OP) = GP − 일반비. GP율·OP율은 순매출 대비입니다. 장려금·일반비 고정비는 고객그룹3별 입력 금액을 그 채널의 제품별 총매출 비중으로 배부하며(누계에는 × 월 진행률), 일반비 변동비는 각 제품 총매출 × 채널 변동비율(%)입니다. 목표는 제품 × 월(구글 시트 target_product)이고 목표비 = 실적 ÷ 목표입니다. 채널로 나눈 단계에는 목표가 없습니다(제품 목표를 채널로 나누지 않음). 판가는 총매출 ÷ 수량(묶음·합계는 수량 가중평균)이고, 판가 증감은 제품은 단가 증감, 묶음은 동일제품 단가 변동률(전월 수량 고정)입니다.</p></details>
      </div>
      <Notices d={d} />
      <PnlExplorer
        rows={d.rows}
        curYm={d.curYm}
        prevYm={d.prevYm}
        progressRate={d.progress.rate}
        targets={d.targets}
        initialView={v ?? 'pivot'}
        exportHref={monthHref('/hierarchy/export', sel.ym, sel.curYm)}
      />
    </div>
  );
}
