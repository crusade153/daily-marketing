import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth-forms';
import { safeNext } from '@/lib/auth';
import { getSession } from '@/lib/session';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <div className="card auth-card">
      <h1>일일 매출·손익</h1>
      <LoginForm next={next} />
    </div>
  );
}
