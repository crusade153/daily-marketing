import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifySession, type Session } from './auth';

/** 현재 로그인 세션. proxy가 1차로 막지만, 서버 액션 등에서 한 번 더 확인할 때 쓴다 */
export async function getSession(): Promise<Session | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return verifySession((await cookies()).get(AUTH_COOKIE)?.value, secret);
}
