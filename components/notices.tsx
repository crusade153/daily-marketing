import Link from 'next/link';
import { eok, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { DashboardData } from '@/lib/types';

export default function Notices({ d }: { d: DashboardData }) {
  const { unitSales, rateSales, noneSales } = d.coverage;
  const total = unitSales + rateSales + noneSales;
  const items: React.ReactNode[] = [];
  const { l1Total, curFilled, prevFilled } = d.inputStatus;

  if (curFilled < l1Total || prevFilled < l1Total) {
    items.push(
      <>
        장려금·일반비 입력: {monthLabel(d.curYm)} {curFilled}/{l1Total}개 LV1, {monthLabel(d.prevYm)} {prevFilled}/
        {l1Total}개 LV1.{' '}
        <Link href="/input" className="font-semibold underline">
          입력하기
        </Link>
      </>,
    );
  }
  if (total && rateSales + noneSales) {
    items.push(
      <>
        당월 매출 중 {pct((rateSales + noneSales) / total)}({eok(rateSales + noneSales)})는 3개월 원가 이력이 없어 계층 원가율로
        대체했습니다.
      </>,
    );
  }
  if (d.storage === 'local') {
    items.push(<>SHEET_ID가 설정되지 않아 입력값을 로컬 파일(.data)에 저장 중입니다.</>);
  }
  if (!items.length) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-[var(--warn-bg)] px-4 py-3 text-[13px] text-[var(--warn-text)]">
      {items.map((it, i) => (
        <li key={i}>· {it}</li>
      ))}
    </ul>
  );
}
