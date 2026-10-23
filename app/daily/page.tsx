import DailyChart from '@/components/daily-chart';
import { getDaily } from '@/lib/data';
import { daysIn } from '@/lib/period';

export const dynamic = 'force-dynamic';

export default async function DailyPage() {
  const { periods: p, daily } = await getDaily();
  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h1>일별 매출</h1>
        <p>일별 매출과 누계 흐름을 전월 동일 경과일 기준으로 비교합니다. 금액 단위: 백만원.</p>
      </div>
      <DailyChart daily={daily} curYm={p.curYm} prevYm={p.prevYm} daysInMonth={p.daysInMonth} prevDays={daysIn(p.prevYm)} />
    </div>
  );
}
