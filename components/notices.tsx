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
  if (!missing && !replacement && !prevLedger && d.storage !== 'local') return null;
  return (
    <div className="notice-bar" role="note" aria-label="데이터 확인 사항">
      <span className="notice-label">확인 사항</span>
      {missing && <span>장려금·일반비 입력 <b>{monthLabel(d.curYm)} {curFilled}/{chTotal}</b>{prevLedger ? '개 채널' : <> · {monthLabel(d.prevYm)} {prevFilled}/{chTotal}개 채널</>}</span>}
      {prevLedger && <span title="수기 입력이 없는 마감월은 회계원장 매출조정(41xx)을 장려금으로, 물류비·광고판촉비·수수료(61xx)를 일반비로 넣고 채널·제품 총매출 비중으로 배부합니다">{monthLabel(d.prevYm)} 장려금·일반비 <b>SAP 원장 실적</b> (매출 비중 배부)</span>}
      {replacement && <span>원가율 대체 적용 <b>{pct((rateSales + noneSales) / total)}</b> ({eok(rateSales + noneSales)})</span>}
      {d.storage === 'local' && <span>입력값은 현재 개발 환경에 저장됩니다.</span>}
      {missing && <Link href="/input" prefetch={false} className="notice-action">비용 입력 →</Link>}
    </div>
  );
}
