'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import RefreshButton from './refresh-button';

const LINKS = [
  { href: '/', label: '경영 요약' },
  { href: '/hierarchy', label: '손익 분석' },
  { href: '/trend', label: '월별 추이' },
  { href: '/segment', label: 'ABCD 등급관리' },
  { href: '/daily', label: '일별 매출' },
  { href: '/input', label: '장려금·일반비 입력' },
  { href: '/mapping', label: '제품 매핑' },
];

export default function Nav() {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  // 경로가 바뀌면 모바일 메뉴를 닫는다 (렌더 중 이전 값 비교)
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setMenu(false);
  }
  if (path === '/login') return null;
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const current = LINKS.find((l) => isActive(l.href));
  return (
    <header className="app-header">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>일일 매출·손익<span className="brand-caption">BUSINESS PERFORMANCE</span></span>
        </Link>
        <nav className="main-nav only-pc" aria-label="주요 메뉴">
          {LINKS.map((l) => {
            const active = isActive(l.href);
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
        <span className="m-current">{current?.label}</span>
        <RefreshButton />
        <button
          type="button"
          className="m-menu-button"
          aria-expanded={menu}
          aria-controls="mobile-menu"
          aria-label="메뉴"
          onClick={() => setMenu((v) => !v)}
        >
          <span aria-hidden="true">{menu ? '✕' : '☰'}</span>
        </button>
      </div>
      {menu && (
        <nav id="mobile-menu" className="m-menu only-mobile" aria-label="주요 메뉴">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} aria-current={isActive(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
