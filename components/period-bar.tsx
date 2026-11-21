import { dateLabel, monthLabel, ymLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';
import MonthStepper from './month-stepper';

export default function PeriodBar({ d, nav }: { d: DashboardData; nav: { ym: string; prevHref: string | null; nextHref: string | null } }) {
  const { elapsed, daysInMonth, rate } = d.progress;
  return (
    <section className="card page-heading" aria-labelledby="summary-heading">
      <div className="report-title">
        <p className="eyebrow">{ymLabel(d.curYm)}</p>
        <h1 id="summary-heading">매출·손익 현황</h1>
      </div>
      <MonthStepper {...nav} />
      <div className="period-status">
        <div className="period-asof">
          <span>데이터 기준</span>
          <b>{d.dataDate ? dateLabel(d.dataDate) : '당월 실적 없음'}</b>
        </div>
        <div className="period-progress">
          <div><span>월 진행률</span> <b>{(rate * 100).toFixed(1)}%</b> <span>({elapsed}/{daysInMonth}일)</span></div>
          <div className="progress-track" role="progressbar" aria-label="월 진행률" aria-valuenow={Math.round(rate * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.min(rate, 1) * 100}%` }} />
          </div>
        </div>
        <details className="basis-details">
          <summary>산출 기준</summary>
          <div className="basis-popover">
            <p><strong>매출</strong> · SAP CO-PA</p>
            <p><strong>월 예상</strong> · 월 진행률로 환산, 입력된 LV3 판매계획 우선 반영</p>
            {!!d.costYms.length && <p><strong>예상 원가</strong> · 판매수량 × {monthLabel(d.costYms[0])}~{monthLabel(d.costYms[d.costYms.length - 1])} 평균 단위원가</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
