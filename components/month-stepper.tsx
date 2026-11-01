'use client';

import Link, { useLinkStatus } from 'next/link';
import { monthLabel } from '@/lib/period';

/** 이동 중 표시: 새 달 데이터를 불러오는 동안 화살표를 흐리게 (조회에 몇 초 걸릴 수 있다) */
function Arrow({ dir }: { dir: 'prev' | 'next' }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? 'is-pending' : undefined}>{dir === 'prev' ? '‹' : '›'}</span>;
}

function Step({ href, dir }: { href: string | null; dir: 'prev' | 'next' }) {
  const label = dir === 'prev' ? '이전 달' : '다음 달';
  if (!href) return <span className="month-step" aria-disabled="true" title={label}>{dir === 'prev' ? '‹' : '›'}</span>;
  // 미리 불러오면 BigQuery 조회가 돌기 때문에 끈다
  return (
    <Link className="month-step" href={href} prefetch={false} scroll={false} aria-label={label} title={label}>
      <Arrow dir={dir} />
    </Link>
  );
}

export default function MonthStepper({ curYm, prevYm, prevHref, nextHref }: { curYm: string; prevYm: string; prevHref: string | null; nextHref: string | null }) {
  return (
    <nav className="month-stepper" aria-label="기준월 이동">
      <Step href={prevHref} dir="prev" />
      <span className="month-stepper-label">
        {monthLabel(prevYm)} 실적 <i aria-hidden="true">·</i> <b>{monthLabel(curYm)} 예상</b>
      </span>
      <Step href={nextHref} dir="next" />
    </nav>
  );
}
