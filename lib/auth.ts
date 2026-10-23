// 공유 비밀번호 게이트. APP_PASSWORD가 없으면(로컬 개발) 게이트를 끈다.
export const AUTH_COOKIE = 'dm_auth';

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`daily-market:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
