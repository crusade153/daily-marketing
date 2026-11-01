import Link from 'next/link';
import { eok, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';

export default function Notices({ d }: { d: DashboardData }) {
  const { unitSales, rateSales, noneSales } = d.coverage;
  const total = unitSales + rateSales + noneSales;
  const { chTotal, curFilled, prevFilled } = d.inputStatus;
  // 원장으로 채운 달은 매출 있는 채널 전체에 배부됐으므로 입력 완료로 본다
  const prevLedger = d.ledgerYms.includes(d.prevYm);
  const missing = curFilled < chTotal || (!prevLedger && prevFilled < chTotal);
  const replacement = total > 0 && rateSales + noneSales !== 0;
  const basis = d.costYms.length ? `${monthLabel(d.costYms[0])}~${monthLabel(d.costYms[d.costYms.length - 1])}` : '';
  const prevOpen = d.costOpen.includes(d.prevYm);
  const curOpen = d.costOpen.includes(d.curYm);
  return (
    <div className="notice-bar" role="note" aria-label="데이터 확인 사항">
      <span className="notice-label">확인 사항</span>
      {/* 원가 기준월은 항상 보여 준다: 결산 전인 달은 평균에서 빠지므로 달마다 바뀔 수 있다 */}
      <span>{monthLabel(d.curYm)} 원가 <b>{basis} 평균 단위원가</b></span>
      {d.costOpen.length > 0 && (
        <span className="notice-alert" title="CO-PA 실제원가가 그 달 매출의 절반에 못 미치면 원가 결산 전으로 봅니다 (결산 전 1% 안팎, 결산 후 100% 안팎)">
          <b>{d.costOpen.map(monthLabel).join('·')} 원가 결산 전</b>
          {prevOpen && ` · ${monthLabel(d.prevYm)} 실적 원가는 ${basis} 평균으로 추정`}
          {curOpen && ` · ${monthLabel(d.curYm)}은 ${basis} 평균으로 추정`}
        </span>
      )}
      {missing && <span>장려금·일반비 입력 <b>{monthLabel(d.curYm)} {curFilled}/{chTotal}</b>{prevLedger ? '개 채널' : <> · {monthLabel(d.prevYm)} {prevFilled}/{chTotal}개 채널</>}</span>}
      {prevLedger && <span title="수기 입력이 없는 마감월은 회계원장 매출조정(41xx)을 장려금으로, 물류비·광고판촉비·수수료(61xx)를 일반비로 넣고 채널·제품 총매출 비중으로 배부합니다">{monthLabel(d.prevYm)} 장려금·일반비 <b>SAP 원장 실적</b> (매출 비중 배부)</span>}
      {replacement && <span>원가율 대체 적용 <b>{pct((rateSales + noneSales) / total)}</b> ({eok(rateSales + noneSales)})</span>}
      {d.storage === 'local' && <span>입력값은 현재 개발 환경에 저장됩니다.</span>}
      {missing && <Link href="/input" prefetch={false} className="notice-action">비용 입력 →</Link>}
    </div>
  );
}
