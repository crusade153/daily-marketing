// 기간 계산. 모든 날짜는 KST 기준 'YYYYMMDD' / 'YYYYMM' 문자열.

export interface Periods {
  today: string; // YYYYMMDD
  curYm: string; // 당월
  prevYm: string; // 전월
  costYms: string[]; // 원가 평균 대상 3개월 (오래된 달 → 최근 달)
  curStart: string;
  curEnd: string; // 당월 말일
  prevStart: string;
  prevEnd: string;
  costStart: string;
  costEnd: string;
  daysInMonth: number; // 당월 달력 일수
}

export function kstToday(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10).replaceAll('-', '');
}

export function shiftYm(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}${String(mm + 1).padStart(2, '0')}`;
}

/** from ~ to (YYYYMM, 양 끝 포함). from > to 이면 빈 배열 */
export function ymRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

/** 월별 추이·입력의 시작월 = 당월이 속한 해의 1월 */
export const yearStartOf = (ym: string) => `${ym.slice(0, 4)}01`;

export function daysIn(ym: string): number {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)), 0).getDate();
}

const monthEnd = (ym: string) => `${ym}${String(daysIn(ym)).padStart(2, '0')}`;

export function getPeriods(today: string = kstToday()): Periods {
  const curYm = today.slice(0, 6);
  const prevYm = shiftYm(curYm, -1);
  const costYms = [shiftYm(curYm, -3), shiftYm(curYm, -2), prevYm];
  return {
    today,
    curYm,
    prevYm,
    costYms,
    curStart: `${curYm}01`,
    curEnd: monthEnd(curYm),
    prevStart: `${prevYm}01`,
    prevEnd: monthEnd(prevYm),
    costStart: `${costYms[0]}01`,
    costEnd: monthEnd(prevYm),
    daysInMonth: daysIn(curYm),
  };
}

/** 진행률 = 데이터 기준일의 일자 ÷ 당월 달력 일수 (예: 10일 → 10/31) */
export function progressOf(dataDate: string | null, daysInMonth: number) {
  const elapsed = dataDate ? Number(dataDate.slice(6, 8)) : 0;
  return { elapsed, daysInMonth, rate: daysInMonth ? elapsed / daysInMonth : 0 };
}

export const ymLabel = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월`;
export const monthLabel = (ym: string) => `${Number(ym.slice(4, 6))}월`;
export const dateLabel = (d: string) => `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
