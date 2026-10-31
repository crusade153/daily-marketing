// 로그인 세션 쿠키. 사용자 계정은 권한관리 구글 시트(lib/users.ts)에 있고, 쿠키에는 서명된 세션만 담는다.
// proxy.ts에서도 쓰므로 Web Crypto만 사용한다 (server-only·googleapis 금지).
export const AUTH_COOKIE = 'dm_session';
export const SESSION_DAYS = 30;
/** 세션을 시트와 다시 대조하는 주기. ROLE을 지우면 늦어도 이 시간 안에 접속이 끊긴다 */
export const RECHECK_MS = 5 * 60 * 1000;

export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  id: string; // 로그인 아이디
  name: string;
  role: Role;
  exp: number; // 만료 (ms)
  chk: number; // 마지막으로 시트와 대조한 시각 (ms)
}

/** 시트 ROLE 칸 값 → 역할. 비어 있거나 모르는 값이면 null (시트에서는 USER로 본다, lib/users.ts) */
export function toRole(v: unknown): Role | null {
  const s = String(v ?? '').trim().toUpperCase();
  return (ROLES as readonly string[]).includes(s) ? (s as Role) : null;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof s.exp !== 'number' || s.exp < Date.now() || !toRole(s.role)) return null;
    return s;
  } catch {
    return null;
  }
}

export const cookieOptions = (exp: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  expires: new Date(exp),
});

/** 로그인 후 돌아갈 경로. 외부 주소로 튀지 않도록 같은 사이트 경로만 받는다 */
export function safeNext(v: unknown): string {
  const s = String(v ?? '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}
