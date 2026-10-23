import TrendView from '@/components/trend-view';
import { getTrend } from '@/lib/data';
import type { Axis } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

// 제품 축은 행이 1,700개가 넘어 월별 표로는 읽을 수 없어 뺀다 (제품별 매출 화면에서 본다)
const AXES: Axis[] = ['l1', 'l2', 'l3', 'l4', 'cm1', 'cm2', 'cm3', 'category', 'owner'];

export default async function TrendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { axis: q } = await searchParams;
  const axis = AXES.find((a) => a === q) ?? 'l1';
  const data = await getTrend(axis);
  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h1>월별 실적 추이</h1>
        <p>연간 매출·이익률 흐름과 전월 대비 변동 요인을 확인합니다. 당월은 월말 예상, 이전 월은 마감 실적입니다.</p>
      </div>
      <TrendView key={axis} data={data} axes={AXES} />
    </div>
  );
}
