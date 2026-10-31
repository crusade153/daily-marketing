'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { login, signup } from '@/actions/auth-actions';

const input = 'w-full rounded-md border border-border px-3 py-2';
const submit = 'w-full rounded-md bg-accent py-2 font-semibold text-white disabled:opacity-50';

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input className={input} required {...props} />
    </label>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <Field label="아이디" name="loginId" autoComplete="username" autoFocus />
      <Field label="비밀번호" name="password" type="password" autoComplete="current-password" />
      {state?.error && <p className="text-xs text-neg" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className={submit}>
        {pending ? '확인 중…' : '로그인'}
      </button>
      <p className="text-center text-xs text-muted">
        계정이 없나요? <Link href="/signup" className="font-semibold text-accent">가입 신청</Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  if (state?.done) {
    return (
      <div className="space-y-3 text-sm">
        {state.approved ? (
          <p className="font-semibold">가입이 완료되었습니다. 바로 로그인할 수 있습니다.</p>
        ) : (
          <>
            <p className="font-semibold">가입 신청이 접수되었습니다.</p>
            <p className="text-muted">관리자가 승인하면 로그인할 수 있습니다.</p>
          </>
        )}
        <Link href="/login" className={`${submit} block text-center`}>로그인 화면으로</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <Field label="회사 아이디" name="companyId" autoComplete="email" autoFocus defaultValue={state?.values?.companyId} />
      <Field label="이름" name="name" autoComplete="name" defaultValue={state?.values?.name} />
      <Field label="로그인 아이디 (영문·숫자 4자 이상)" name="loginId" autoComplete="username" defaultValue={state?.values?.loginId} />
      <Field label="비밀번호 (6자 이상)" name="password" type="password" autoComplete="new-password" minLength={6} />
      <Field label="비밀번호 확인" name="confirm" type="password" autoComplete="new-password" minLength={6} />
      {state?.error && <p className="text-xs text-neg" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className={submit}>
        {pending ? '신청 중…' : '가입 신청'}
      </button>
      <p className="text-center text-xs text-muted">
        이미 계정이 있나요? <Link href="/login" className="font-semibold text-accent">로그인</Link>
      </p>
    </form>
  );
}
