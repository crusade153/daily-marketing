const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 억원, 소수 1자리 */
export const eok = (n: number) => `${nf1.format(Math.abs(n) < 5e6 ? 0 : n / 1e8)}억`;
/** 백만원 정수 */
export const mil = (n: number) => nf0.format(Math.round(n / 1e6) || 0);
/** 원 정수 */
export const won = (n: number) => nf0.format(Math.round(n));
export const pct = (r: number | null | undefined, digits = 1) =>
  r == null || !Number.isFinite(r) ? '-' : `${(r * 100).toFixed(digits)}%`;
/** %p 차이 */
export const ppt = (a: number | null, b: number | null) =>
  a == null || b == null ? '-' : `${(a - b) * 100 >= 0 ? '+' : ''}${((a - b) * 100).toFixed(1)}%p`;
export const signedMil = (n: number) => `${n >= 0 ? '+' : ''}${mil(n)}`;
export const signedEok = (n: number) => `${n >= 0 ? '+' : ''}${eok(n)}`;
export const growth = (cur: number, base: number) => (base ? cur / base - 1 : null);
export const tone = (n: number | null | undefined) =>
  n == null || n === 0 ? 'text-[var(--muted)]' : n > 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]';
