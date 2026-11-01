import { dateLabel, monthLabel, ymLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';
import MonthStepper from './month-stepper';

export default function PeriodBar({ d, nav }: { d: DashboardData; nav: { ym: string; prevHref: string | null; nextHref: string | null } }) {
  const { elapsed, daysInMonth, rate } = d.progress;
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">{ymLabel(d.curYm)}</p>
        <h1>매출·손익 현황</h1>
        <MonthStepper {...nav} />
      </div>
      <div className="period-status">
        <span className="status-dot" aria-hidden="true" />
        <span>데이터 기준 <b>{d.dataDate ? dateLabel(d.dataDate) : '당월 실적 없음'}</b></span>
        <div className="period-progress">
          <span>월 진행률 <b>{(rate * 100).toFixed(1)}%</b> <span className="text-muted">({elapsed}/{daysInMonth}일)</span></span>
          <div className="progress-track" role="progressbar" aria-label="월 진행률" aria-valuenow={Math.round(rate * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.min(rate, 1) * 100}%` }} />
          </div>
        </div>
        <details className="basis-details">
          <summary>산출 기준</summary>
          <div className="basis-popover">
            <b>예상 손익 산출 기준</b>
            <p>당월 매출원가: 판매수량 × {monthLabel(d.costYms[0])}~{monthLabel(d.costYms[d.costYms.length - 1])} 평균 단위원가 (원가 결산 전인 달은 빼고 그 앞 달로)</p>
            <p>월 예상: 누계 ÷ 경과일수 × 월 달력일수</p>
            <p>전월: {monthLabel(d.prevYm)} 마감 실적 · 매출 원천: CO-PA</p>
          </div>
        </details>
      </div>
    </section>
  );
}
