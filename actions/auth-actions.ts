'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

export async function login(_: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const password = process.env.APP_PASSWORD;
  const input = String(formData.get('password') ?? '');
  if (password && input !== password) return { error: '비밀번호가 맞지 않습니다.' };
  if (password) {
    (await cookies()).set(AUTH_COOKIE, await authToken(password), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  redirect('/');
}
