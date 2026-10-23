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
      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
      title="BigQuery와 구글 시트를 다시 읽습니다"
    >
      {pending ? '불러오는 중…' : '데이터 새로고침'}
    </button>
  );
}
