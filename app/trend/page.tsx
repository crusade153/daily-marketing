import TrendView from '@/components/trend-view';
import MonthStepper from '@/components/month-stepper';
import { getTrend } from '@/lib/data';
import { monthLinks } from '@/lib/month';
import { pageMonth } from '@/lib/month-server';
import type { Axis } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

// 제품 축은 행이 1,700개가 넘어 월별 표로는 읽을 수 없어 뺀다 (제품별 손익 분석에서 본다).
// 제품계층 LV2~LV4는 쓰지 않는다 (2026-10-30 사용자 요청: 계층 구조 대신 CM·PM·제품라인·채널)
const AXES: Axis[] = ['cm', 'owner', 'category', 'l1', 'ch', 'rep'];

export default async function TrendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { axis: q, ym } = await searchParams;
  const axis = AXES.find((a) => a === q) ?? 'cm';
  const sel = await pageMonth(ym);
  const data = await getTrend(axis, sel.today);
  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h1>월별 실적 추이</h1>
        <MonthStepper {...monthLinks('/trend', sel, { axis: axis === 'cm' ? null : axis })} />
        <p>연간 매출·이익률 흐름과 전월 대비 변동 요인을 확인합니다. 당월은 월말 예상, 이전 월은 마감 실적입니다.</p>
      </div>
      <TrendView key={`${axis}-${sel.ym}`} data={data} axes={AXES} ym={sel.today ? sel.ym : null} />
    </div>
  );
}
