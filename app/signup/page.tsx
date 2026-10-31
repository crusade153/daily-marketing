import { redirect } from 'next/navigation';
import { SignupForm } from '@/components/auth-forms';
import { getSession } from '@/lib/session';

export default async function SignupPage() {
  if (await getSession()) redirect('/');
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="card w-full max-w-xs space-y-4 px-5 py-6">
        <div>
          <h1 className="text-base font-bold">가입 신청</h1>
          <p className="mt-1 text-xs text-muted">관리자 승인 후 로그인 아이디와 비밀번호로 들어올 수 있습니다.</p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}
