import { dateLabel, monthLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';

export default function PeriodBar({ d }: { d: DashboardData }) {
  const { elapsed, daysInMonth, rate } = d.progress;
  const costRange = `${monthLabel(d.costYms[0])}~${monthLabel(d.costYms[2])}`;
  return (
    <section className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
      <div>
        <div className="text-xs text-muted">데이터 기준일</div>
        <div className="text-lg font-bold">{d.dataDate ? dateLabel(d.dataDate) : '당월 실적 없음'}</div>
      </div>
      <div className="min-w-[220px] flex-1">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>
            {monthLabel(d.curYm)} 진행률 · {elapsed}일 ÷ {daysInMonth}일
          </span>
          <span className="font-semibold text-text">{(rate * 100).toFixed(1)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(rate, 1) * 100}%` }} />
        </div>
      </div>
      <div className="text-xs leading-5 text-muted">
        <div>
          당월 매출원가 = 판매수량 × <b className="text-text">{costRange} 평균 단위원가</b>
        </div>
        <div>
          당월 예상 = 누계 ÷ {elapsed}일 × {daysInMonth}일 · 전월({monthLabel(d.prevYm)}) = CO-PA 실적
        </div>
      </div>
    </section>
  );
}
