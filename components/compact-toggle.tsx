'use client';

import { useEffect, useState } from 'react';

const KEY = 'dm-list-compact';

/**
 * 손익 표 위 영역(페이지 설명·계산 기준·등급 신호등) 접기·펴기. 표가 화면을 더 쓰게 한다.
 * 숨기는 일은 CSS가 한다: `.data-page:has(.compact-toggle[aria-pressed=true])` (globals.css).
 * 기본은 접힘, 고른 상태는 브라우저에 기억한다 (계층별 손익·제품 목록·채널별 손익 공용). PC에서만 보인다.
 */
export default function CompactToggle() {
  const [compact, setCompact] = useState(true);
  // 브라우저 저장값은 마운트 후에만 읽을 수 있다 — 서버 렌더와 첫 화면을 맞추려고 effect에서 반영
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(KEY) === '0') setCompact(false);
    } catch {
      /* 저장소를 못 쓰면 접힌 채로 */
    }
  }, []);
  const toggle = () => {
    setCompact((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        /* 기억만 못 한다 */
      }
      return !c;
    });
  };
  return (
    <button
      type="button"
      className="compact-toggle only-pc"
      aria-pressed={compact}
      onClick={toggle}
      title={compact ? '페이지 설명·등급 신호등 펼치기' : '페이지 설명·등급 신호등 접고 표를 크게 보기'}
    >
      {compact ? '▾ 위 영역 펼치기' : '▴ 위 영역 접기'}
    </button>
  );
}
