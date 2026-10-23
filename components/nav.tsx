'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import RefreshButton from './refresh-button';

const LINKS = [
  { href: '/', label: '경영 요약' },
  { href: '/hierarchy', label: '계층별 손익' },
  { href: '/products', label: '제품별 매출' },
  { href: '/trend', label: '월별 추이' },
  { href: '/segment', label: 'ABCD 등급관리' },
  { href: '/daily', label: '일별 매출' },
  { href: '/input', label: '장려금·일반비 입력' },
  { href: '/mapping', label: '제품 매핑' },
];

export default function Nav() {
  const path = usePathname();
  if (path === '/login') return null;
  return (
    <header className="app-header">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>일일 매출·손익<span className="brand-caption">BUSINESS PERFORMANCE</span></span>
        </Link>
        <nav className="main-nav" aria-label="주요 메뉴">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
                  active ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <RefreshButton />
      </div>
    </header>
  );
}
