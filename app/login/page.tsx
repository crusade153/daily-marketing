'use client';

import { useActionState } from 'react';
import { login } from '@/actions/auth-actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form action={action} className="card w-full max-w-xs space-y-3 px-5 py-6">
        <h1 className="text-base font-bold">일일 매출·손익</h1>
        <input
          name="password"
          type="password"
          autoFocus
          placeholder="비밀번호"
          className="w-full rounded-md border border-border px-3 py-2"
        />
        {state?.error && <p className="text-xs text-neg">{state.error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-md bg-accent py-2 font-semibold text-white disabled:opacity-50">
          {pending ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </div>
  );
}
