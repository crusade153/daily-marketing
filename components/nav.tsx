'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { logout } from '@/actions/auth-actions';
import RefreshButton from './refresh-button';

const REPORTS = [
  { href: '/', label: '경영 요약', short: '경영 요약', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
  { href: '/segment', label: 'ABCD 등급관리', short: 'ABCD 등급', icon: 'M3 3h18v18H3z M12 3v18 M3 12h18 M7.5 7.5h.01 M16.5 16.5h.01' },
  { href: '/hierarchy', label: '제품별 손익 분석', short: '제품 손익', icon: 'M12 3 3 8l9 5 9-5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5' },
  { href: '/channels', label: '채널별 손익 분석', short: '채널 손익', icon: 'M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4' },
  { href: '/plan', label: '판매계획 대비', short: '판매계획', icon: 'M8 5H5v16h14V5h-3 M8 3h8v4H8z M8 14l3 3 5-6' },
  { href: '/trend', label: '월별 추이', short: '월별 추이', icon: 'M3 4v16h18 M6 15l5-5 4 2 5-6 M16 6h4v4' },
];
const INPUTS = [
  { href: '/input', label: '비용·계획 입력', short: '비용·계획', icon: 'M13 4H4v16h16v-9 M12 15l1-4 7-7 3 3-7 7-4 1z' },
  { href: '/mapping', label: '제품 매핑', short: '제품 매핑', icon: 'M4 4h7v7H4z M13 13h7v7h-7z M16 4h4v4 M20 4l-5 5 M4 16v4h4 M4 20l5-5' },
];
const ADMIN = [
  { href: '/admin/pnl', label: 'SAP 손익', short: 'SAP 손익', icon: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h3 M14 15h2' },
  { href: '/admin/insights', label: '손익 인사이트', short: '인사이트', icon: 'M9 19h6 M10 22h4 M9 16c0-2-3-3-3-7a6 6 0 0 1 12 0c0 4-3 5-3 7z' },
  { href: '/admin/users', label: '회원관리', short: '회원관리', icon: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M21 21v-2a4 4 0 0 0-3-4 M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 3a4 4 0 0 1 0 8' },
];

type User = { name: string; role: string };
type MenuLink = (typeof REPORTS)[number];
const USER_GROUPS = [REPORTS, INPUTS];
const ADMIN_GROUPS = [...USER_GROUPS, ADMIN];

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function Account({ user }: { user: User }) {
  return (
    <form action={logout} className="app-account">
      <span className="account-name" title={user.role}>{user.name || '사용자'}</span>
      <button type="submit" className="header-button">로그아웃</button>
    </form>
  );
}

function LinkPending() {
  const { pending } = useLinkStatus();
  return <span className="link-pending" data-pending={pending || undefined} aria-hidden="true" />;
}

export default function Nav({ user, children }: { user: User | null; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState(false);
  const [briefPending, startBriefNavigation] = useTransition();
  const [lastPath, setLastPath] = useState(path);
  const menuButton = useRef<HTMLButtonElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const isAdmin = user?.role === 'ADMIN';
  const groups = isAdmin ? ADMIN_GROUPS : USER_GROUPS;
  const active = (link: MenuLink) => (
    path === link.href || (link.href === '/hierarchy' && path === '/products')
  );
  const index = REPORTS.findIndex(active);
  const canBrief = index >= 0;
  const previous = REPORTS[index - 1];
  const next = REPORTS[index + 1];

  if (lastPath !== path) {
    setLastPath(path);
    setOpen(false);
    if (!canBrief) setBrief(false);
  }

  useEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [path]);

  useEffect(() => {
    if (!canBrief && shell.current && document.fullscreenElement === shell.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [canBrief]);

  useEffect(() => {
    if (!brief) return;
    exitButton.current?.focus();
    const finish = () => {
      setBrief(false);
      requestAnimationFrame(() => startButton.current?.focus());
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement !== shell.current) finish();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'Escape') {
        if (!document.fullscreenElement) finish();
        return;
      }
      if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable], [role="tab"], [role="tabpanel"], [role="region"]')) return;
      const destination = event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : undefined;
      if (destination) {
        event.preventDefault();
        startBriefNavigation(() => router.push(destination.href));
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [brief, next, previous, router]);

  const startBrief = () => {
    setOpen(false);
    setBrief(true);
    void shell.current?.requestFullscreen?.().catch(() => {});
  };
  const exitBrief = () => {
    if (document.fullscreenElement === shell.current) void document.exitFullscreen().catch(() => {});
    setBrief(false);
    requestAnimationFrame(() => startButton.current?.focus());
  };

  if (path === '/login' || path === '/signup') {
    return <main id="main-content" className="auth-main">{children}</main>;
  }

  const closeMenu = () => setOpen(false);

  return (
    <div ref={shell} className="app-shell" data-briefing={brief || undefined} data-brief-pending={briefPending || undefined}>
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <aside className="app-rail" aria-label="대시보드 탐색">
        <Link href="/" prefetch={false} className="rail-home" aria-label="경영 요약 홈"><BrandMark /></Link>
        <nav className="rail-nav" aria-label="주요 메뉴">
          {groups.map((links) => (
            <div className="rail-group" key={links[0].href}>
              {links.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} aria-current={active(link) ? 'page' : undefined}
                  aria-label={link.label} title={link.label} className="rail-link">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                    <path d={link.icon} />
                  </svg>
                  <span>{link.short}</span>
                  <LinkPending />
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-workspace">
        <header className="app-header" hidden={brief} onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            closeMenu();
            menuButton.current?.focus();
          }
        }}>
          <div className="header-inner">
            <Link href="/" prefetch={false} className="brand" onClick={closeMenu}>
              <span className="mobile-brand-mark"><BrandMark /></span>
              일일 매출·손익
            </Link>
            <div className="header-actions">
              <RefreshButton />
              {canBrief && <button ref={startButton} type="button" className="header-button brief-start" onClick={startBrief} aria-label="브리핑" title="전체화면 브리핑">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 4h18v13H3z M12 17v4 M8 21h8 M9 8l6 3-6 3z" />
                </svg>
                <span>브리핑</span>
              </button>}
              {user && <div className="desktop-account"><Account user={user} /></div>}
              <button ref={menuButton} type="button" className="header-button m-menu-button" aria-expanded={open}
                aria-controls="mobile-menu" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} onClick={() => setOpen(!open)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d={open ? 'm6 6 12 12M18 6 6 18' : 'M4 6h16M4 12h16M4 18h16'} />
                </svg>
              </button>
            </div>
          </div>
          <nav id="mobile-menu" className="m-menu" hidden={!open} aria-label="주요 메뉴">
            {groups.map((links) => (
              <div className="m-menu-group" key={links[0].href}>
                {links.map((link) => (
                  <Link key={link.href} href={link.href} prefetch={false} aria-current={active(link) ? 'page' : undefined} onClick={closeMenu}>
                    {link.label}<LinkPending />
                  </Link>
                ))}
              </div>
            ))}
            {user && <Account user={user} />}
          </nav>
        </header>
        <main ref={main} id="main-content" className="app-main" tabIndex={-1}>{children}</main>
        {brief && <div className="briefing-footer">
            <nav className="briefing-controls" aria-label="브리핑 조작">
              <span className="briefing-label">브리핑 <b className="num">{index + 1} / {REPORTS.length}</b></span>
              <div className="briefing-steps">
                {previous ? <Link href={previous.href} prefetch={false} className="header-button" aria-label={`이전 보고서 · ${previous.label}`}>‹<LinkPending /></Link> : <span className="header-button" aria-disabled="true">‹</span>}
                <select value={REPORTS[index].href} aria-label="브리핑 보고서" onChange={(event) => {
                  const href = event.target.value;
                  startBriefNavigation(() => router.push(href));
                }}>
                  {REPORTS.map((page) => <option value={page.href} key={page.href}>{page.label}</option>)}
                </select>
                {next ? <Link href={next.href} prefetch={false} className="header-button" aria-label={`다음 보고서 · ${next.label}`}>›<LinkPending /></Link> : <span className="header-button" aria-disabled="true">›</span>}
              </div>
              <button ref={exitButton} type="button" className="header-button" onClick={exitBrief}>브리핑 종료</button>
            </nav>
        </div>}
      </div>
    </div>
  );
}
