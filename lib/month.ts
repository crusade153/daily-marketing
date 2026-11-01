// 화면 공통 기준월 선택 (?ym=YYYYMM). 서버 페이지에서 읽고, 화살표 링크와 화면 안 이동 링크에 붙인다.
import { kstToday, monthEnd, shiftYm } from './period.ts';

/** 기준월은 당월과 직전 1개월만 고를 수 있다 (월초 결산 전에 전월을 '예상'으로 보려는 용도) */
export const BACK_MONTHS = 1;

/** 마지막으로 고른 기준월 쿠키. 주소에 ?ym이 있으면 proxy가 저장하고, 없으면 페이지가 이 값을 쓴다 → 메뉴를 옮겨도 유지 */
export const MONTH_COOKIE = 'dm_ym';
export const MONTH_COOKIE_MAX_AGE = 12 * 60 * 60; // 12시간 — 다음 날에는 당월로 돌아간다
export const isYm = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

export interface MonthSel {
  ym: string; // 고른 기준월
  curYm: string; // 실제 당월
  /** 데이터 함수에 넘기는 '오늘'. 당월이면 undefined, 지난달이면 그 달 말일 → 그 달이 당월(예상), 그 전달이 전월(실적) */
  today: string | undefined;
  prevYm: string | null; // ‹ 로 갈 달
  nextYm: string | null; // › 로 갈 달
}

export function selectMonth(q: unknown, now: string = kstToday()): MonthSel {
  const curYm = now.slice(0, 6);
  const minYm = shiftYm(curYm, -BACK_MONTHS);
  const ym = isYm(q) && q >= minYm && q < curYm ? q : curYm;
  return {
    ym,
    curYm,
    today: ym === curYm ? undefined : monthEnd(ym),
    prevYm: ym > minYm ? shiftYm(ym, -1) : null,
    nextYm: ym < curYm ? shiftYm(ym, 1) : null,
  };
}

/** 경로 + 다른 쿼리를 지키고 ym만 바꾼 주소. 당월도 ym을 적는다 — 빼면 저장된 지난달 쿠키로 돌아가기 때문 */
export function monthHref(path: string, ym: string | null, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (ym) q.set('ym', ym);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** 화살표 두 개의 주소 (갈 수 없으면 null) */
export function monthLinks(path: string, sel: MonthSel, params: Record<string, string | null | undefined> = {}) {
  return {
    ym: sel.ym,
    prevHref: sel.prevYm ? monthHref(path, sel.prevYm, params) : null,
    nextHref: sel.nextYm ? monthHref(path, sel.nextYm, params) : null,
  };
}
