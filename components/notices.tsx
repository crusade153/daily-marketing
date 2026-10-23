import Link from 'next/link';
import { eok, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';

export default function Notices({ d }: { d: DashboardData }) {
  const { unitSales, rateSales, noneSales } = d.coverage;
  const total = unitSales + rateSales + noneSales;
  const { l1Total, curFilled, prevFilled } = d.inputStatus;
  const missing = curFilled < l1Total || prevFilled < l1Total;
  const replacement = total > 0 && rateSales + noneSales !== 0;
  if (!missing && !replacement && d.storage !== 'local') return null;
  return (
    <div className="notice-bar" role="note" aria-label="데이터 확인 사항">
      <span className="notice-label">확인 사항</span>
      {missing && <span>장려금·일반비 입력 <b>{monthLabel(d.curYm)} {curFilled}/{l1Total}</b> · {monthLabel(d.prevYm)} {prevFilled}/{l1Total}개 계층</span>}
      {replacement && <span>원가율 대체 적용 <b>{pct((rateSales + noneSales) / total)}</b> ({eok(rateSales + noneSales)})</span>}
      {d.storage === 'local' && <span>입력값은 현재 개발 환경에 저장됩니다.</span>}
      {missing && <Link href="/input" prefetch={false} className="notice-action">비용 입력 →</Link>}
    </div>
  );
}
