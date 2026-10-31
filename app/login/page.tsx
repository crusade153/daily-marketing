import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth-forms';
import { safeNext } from '@/lib/auth';
import { getSession } from '@/lib/session';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="card w-full max-w-xs space-y-4 px-5 py-6">
        <h1 className="text-base font-bold">일일 매출·손익</h1>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
