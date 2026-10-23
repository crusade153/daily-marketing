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
      <div>
        <h1 className="text-lg font-bold">월별 추이</h1>
        <p className="text-xs text-muted">
          올해 1월부터의 월 손익입니다. 마감월은 CO-PA 실적 매출·실제원가에 그 달 입력한 장려금·일반비를 더하고, 진행 중인 달은
          요약 화면의 월 예상과 같습니다.
        </p>
      </div>
      <TrendView key={axis} data={data} axes={AXES} />
    </div>
  );
}
