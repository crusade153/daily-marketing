import 'server-only';
import { cookies } from 'next/headers';
import { isYm, MONTH_COOKIE, selectMonth, type MonthSel } from './month';

/** 페이지 기준월: 주소의 ?ym, 없으면 마지막으로 고른 달(쿠키, proxy가 저장). 범위 밖이면 당월 */
export async function pageMonth(q: unknown): Promise<MonthSel> {
  return selectMonth(isYm(q) ? q : (await cookies()).get(MONTH_COOKIE)?.value);
}
