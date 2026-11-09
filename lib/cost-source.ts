// 장려금·일반비 원천 표시 (화면 공통)
import type { CostSource, MonthInputStatus } from './types';

export const SOURCE_LABEL: Record<CostSource, string> = {
  link: '판관비 실적',
  open: '판관비 미마감',
  manual: '수기 입력',
  ledger: 'SAP 원장',
  none: '미입력',
};

/** 그 달 비용이 하나도 없는가 (영업이익에 장려금·일반비가 빠짐) */
export const costMissing = (s: MonthInputStatus) => s.source === 'none';

/** 수기 입력 달의 입력 현황 문구: '장려금 영업그룹 3/8 · 일반비 고객그룹3 10/40' */
export function manualText(s: MonthInputStatus, sgTotal: number, chTotal: number): string {
  return `장려금 영업그룹 ${s.sg}/${sgTotal} · 일반비 고객그룹3 ${s.ch}/${chTotal}`;
}

/** 원천 한 줄 요약: 수기 입력이면 입력 현황, 아니면 원천 이름 */
export function sourceText(s: MonthInputStatus, sgTotal: number, chTotal: number): string {
  return s.source === 'manual' ? manualText(s, sgTotal, chTotal) : `장려금·일반비 ${SOURCE_LABEL[s.source]}`;
}
