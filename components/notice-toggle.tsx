'use client';

import { useEffect, useState } from 'react';

const KEY = 'dm-notices-open';

/**
 * 확인 사항 막대 접기·펴기. 내용은 서버에서 그려 children으로 받는다.
 * 기본은 접힘 — 접혀 있어도 항목 수와 경고(원가 결산 전 등)는 보인다. 고른 상태는 브라우저에 기억한다.
 */
export default function NoticeToggle({ count, alert, children }: { count: number; alert: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // 브라우저 저장값은 마운트 후에만 읽을 수 있다 — 서버 렌더와 첫 화면을 맞추려고 effect에서 반영
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(KEY) === '1') setOpen(true);
    } catch {
      /* 저장소를 못 쓰면 접힌 채로 */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? '0' : '1');
      } catch {
        /* 기억만 못 한다 */
      }
      return !o;
    });
  };
  return (
    <div className={`notice-bar ${open ? '' : 'is-collapsed'}`} role="note" aria-label="데이터 확인 사항">
      <button type="button" className="notice-label notice-toggle" aria-expanded={open} onClick={toggle} title={open ? '확인 사항 접기' : '확인 사항 펼치기'}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> 확인 사항 <span className="notice-count">{count}</span>
      </button>
      {open ? children : alert && <span className="notice-alert">{alert}</span>}
    </div>
  );
}
