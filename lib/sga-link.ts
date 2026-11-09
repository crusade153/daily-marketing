// 판관비 대시보드(sga-calc) 연동 — 순수 계산.
//   원천: 구글 시트 sga_link 탭. sga-calc scripts/export-daily-marketing.mts가 JSON을 만들고
//   이 저장소 scripts/import-sga-link.mts가 시트에 올린다 (저장소가 공개라 금액 파일은 커밋하지 않는다)
//   장려금(거래처 적요 매칭 → 통합거래처 배부)·판관비(배부정책 정규화 배부)를 고객그룹3 × 월로 묶은 값
//   내보낸 달은 마감 여부와 관계없이 그대로 쓴다 (미마감 달은 들어온 만큼). 그 뒤의 달은 수기 입력 (lib/data.ts withChannelCosts)
// 판관비 대시보드는 판관비 전체(인건비 포함)를 배부하므로, 연동한 달의 '일반비'는 판관비 전체다.

import type { ChannelInput } from './types';

export interface SgaLinkChannel {
  ch: string; // 고객그룹3 (앞자리 0 제거)
  sales: number; // 판관비 대시보드 식품 매출 모집단
  incentive: number;
  sga: number;
}

export interface SgaLinkMonth {
  ym: string; // YYYYMM
  closed: boolean;
  totals: { sales: number; incentive: number; sga: number };
  channels: SgaLinkChannel[];
}

export interface SgaLink {
  source: string;
  generatedAt: string;
  months: SgaLinkMonth[];
}

/** 시트 한 줄 (TABS.sgaLink 열 순서) */
export type SgaLinkRow = [ym: string, ch: string, sales: number, incentive: number, sga: number, closed: string, generatedAt: string];

/** 시트 행 → 연동 데이터. 마감 열은 'Y'/'N' */
export function linkFromRows(rows: SgaLinkRow[]): SgaLink {
  const months = new Map<string, SgaLinkMonth>();
  let generatedAt = '';
  for (const [ym, ch, sales, incentive, sga, closed, at] of rows) {
    if (!/^\d{6}$/.test(ym)) continue;
    let m = months.get(ym);
    if (!m) months.set(ym, (m = { ym, closed: closed === 'Y', totals: { sales: 0, incentive: 0, sga: 0 }, channels: [] }));
    m.channels.push({ ch, sales, incentive, sga });
    m.totals.sales += sales;
    m.totals.incentive += incentive;
    m.totals.sga += sga;
    if (at > generatedAt) generatedAt = at;
  }
  return { source: 'sga-calc', generatedAt, months: [...months.values()].sort((a, b) => a.ym.localeCompare(b.ym)) };
}

/** 연동 데이터 → 시트 행 */
export function linkToRows(link: SgaLink): SgaLinkRow[] {
  return link.months.flatMap((m) => m.channels.map((c): SgaLinkRow => [m.ym, c.ch, c.sales, c.incentive, c.sga, m.closed ? 'Y' : 'N', link.generatedAt]));
}

export const SGA_ACTUAL_AUTHOR = '판관비 실적';

export const stripCh = (c: string) => c.replace(/^0+/, '');

/** 채널 이름표: 앞자리 0을 뗀 코드 → 대시보드 채널 코드·이름 */
export type ChannelNames = Map<string, { ch: string; cht: string }>;

const nameOf = (names: ChannelNames, ch: string) => names.get(stripCh(ch)) ?? { ch: ch || '-', cht: ch ? `고객그룹3 ${ch}` : '(미지정)' };

/** 연동 실적 → 채널 비용 입력 (장려금 금액, 일반비 = 배부 판관비) */
export function linkActualInputs(m: SgaLinkMonth, names: ChannelNames): ChannelInput[] {
  return m.channels
    .filter((c) => c.incentive || c.sga)
    .map((c) => ({ ...nameOf(names, c.ch), ym: m.ym, incentive: c.incentive, general: c.sga, rate: 0, updatedAt: '', updatedBy: SGA_ACTUAL_AUTHOR }));
}

/** 마감 실적이 있는 마지막 달 */
export const lastClosedYm = (link: SgaLink) => link.months.filter((m) => m.closed).reduce((a, m) => (m.ym > a ? m.ym : a), '');
