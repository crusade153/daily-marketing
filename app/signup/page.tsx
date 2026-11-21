import { redirect } from 'next/navigation';
import { SignupForm } from '@/components/auth-forms';
import { getSession } from '@/lib/session';

export default async function SignupPage() {
  if (await getSession()) redirect('/');
  return (
    <div className="card auth-card">
      <div>
        <h1>가입 신청</h1>
        <p className="mt-2 text-sm text-muted">관리자 승인 후 로그인 아이디와 비밀번호로 들어올 수 있습니다.</p>
      </div>
      <SignupForm />
    </div>
  );
}
