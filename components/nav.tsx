'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import RefreshButton from './refresh-button';

const LINKS = [
  { href: '/', label: '요약' },
  { href: '/hierarchy', label: '계층별 손익' },
  { href: '/products', label: '제품별 매출' },
  { href: '/trend', label: '월별 추이' },
  { href: '/daily', label: '일별 매출' },
  { href: '/input', label: '장려금·일반비 입력' },
  { href: '/mapping', label: '제품 매핑' },
];

export default function Nav() {
  const path = usePathname();
  if (path === '/login') return null;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <Link href="/" className="text-[15px] font-bold tracking-tight">
          일일 매출·손익
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
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
