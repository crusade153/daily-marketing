import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, cookieOptions, RECHECK_MS, signSession, verifySession } from '@/lib/auth';
import { isYm, MONTH_COOKIE, MONTH_COOKIE_MAX_AGE } from '@/lib/month';
import { findUserCached } from '@/lib/users';

// 로그인한 사용자만 통과. 세션 쿠키 서명을 확인하고, RECHECK_MS마다 권한관리 시트와 다시 대조해
// STATUS가 ACTIVE가 아니거나 계정이 삭제된 사용자를 내보낸다. AUTH_SECRET이 없으면 모두 막는다.
export async function proxy(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const session = secret ? await verifySession(request.cookies.get(AUTH_COOKIE)?.value, secret) : null;
  if (!secret || !session) return toLogin(request);
  // 관리자 화면은 쿠키 역할로 1차 차단 (페이지·액션에서 시트 기준으로 다시 확인)
  if (request.nextUrl.pathname.startsWith('/admin') && session.role !== 'ADMIN') return NextResponse.redirect(new URL('/', request.url));

  if (Date.now() - session.chk < RECHECK_MS) return rememberMonth(request, NextResponse.next());
  let user;
  try {
    user = await findUserCached(session.id);
  } catch (e) {
    // 시트를 잠깐 못 읽을 때는 기존 세션을 유지하고 다음 요청에서 다시 대조한다
    console.error('session recheck', e);
    return rememberMonth(request, NextResponse.next());
  }
  if (user?.status !== 'ACTIVE') {
    const res = toLogin(request);
    res.cookies.delete(AUTH_COOKIE);
    return res;
  }
  const res = NextResponse.next();
  const fresh = { ...session, name: user.name, role: user.role, chk: Date.now() };
  res.cookies.set(AUTH_COOKIE, await signSession(fresh, secret), cookieOptions(fresh.exp));
  return rememberMonth(request, res);
}

/** 주소에 ?ym이 있으면 기준월 쿠키로 저장 → ?ym 없이 다른 메뉴로 가도 그 달로 열린다 (lib/month-server.ts) */
function rememberMonth(request: NextRequest, res: NextResponse) {
  const ym = request.nextUrl.searchParams.get('ym');
  if (isYm(ym) && request.cookies.get(MONTH_COOKIE)?.value !== ym) {
    res.cookies.set(MONTH_COOKIE, ym, { path: '/', httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: MONTH_COOKIE_MAX_AGE });
  }
  return res;
}

function toLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = '/login';
  url.search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|signup|_next/static|_next/image|favicon.ico).*)'],
};
