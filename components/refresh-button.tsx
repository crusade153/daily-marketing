'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refreshAll } from '@/actions/input-actions';

export default function RefreshButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await refreshAll();
          router.refresh();
        })
      }
      className="header-button"
      title="BigQuery와 구글 시트를 다시 읽습니다"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5 M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5" />
      </svg>
      {pending ? '불러오는 중…' : <span><span className="only-pc">데이터 </span>새로고침</span>}
    </button>
  );
}
