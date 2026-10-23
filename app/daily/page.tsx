import DailyChart from '@/components/daily-chart';
import { getDaily } from '@/lib/data';
import { daysIn } from '@/lib/period';

export const dynamic = 'force-dynamic';

export default async function DailyPage() {
  const { periods: p, daily } = await getDaily();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">일별 매출</h1>
        <p className="text-xs text-muted">CO-PA 총매출(VV101) 기준. 전월은 같은 일자까지의 누계와 비교합니다.</p>
      </div>
      <DailyChart daily={daily} curYm={p.curYm} prevYm={p.prevYm} daysInMonth={p.daysInMonth} prevDays={daysIn(p.prevYm)} />
    </div>
  );
}
