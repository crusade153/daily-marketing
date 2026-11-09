// 판관비 대시보드(sga-calc) 연동 — 순수 계산.
//   원천: 구글 시트 sga_link 탭. sga-calc scripts/export-daily-marketing.mts가 JSON을 만들고
//   이 저장소 scripts/import-sga-link.mts가 시트에 올린다 (저장소가 공개라 금액 파일은 커밋하지 않는다)
//   마감월 = 장려금(거래처 적요 매칭 → 통합거래처 배부)·판관비(배부정책 정규화 배부) 실적을 고객그룹3 × 월로 묶은 값
//   미마감 달(전월 마감 중·당월) = 직전 마감 3개월의 채널별 비율로 예측
//     장려금 = 채널 장려금률 × 그 달 채널 월 매출(당월은 월말 예상 매출)
//     판관비 = 채널 판관비율(%)을 일반비 변동비율로 넣는다 → 각 제품 총매출 × 비율 (누계·예상 각각)
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
export const SGA_FCST_AUTHOR = '판관비 예측';
/** 예측 비율을 낼 때 쓰는 직전 마감월 수 */
export const SGA_BASE_MONTHS = 3;

export const stripCh = (c: string) => c.replace(/^0+/, '');

/** 채널 이름표: 앞자리 0을 뗀 코드 → 대시보드 채널 코드·이름 */
export type ChannelNames = Map<string, { ch: string; cht: string }>;

const nameOf = (names: ChannelNames, ch: string) => names.get(stripCh(ch)) ?? { ch: ch || '-', cht: ch ? `고객그룹3 ${ch}` : '(미지정)' };

/** 마감월 실적 → 채널 비용 입력 (장려금 금액, 일반비 고정비 = 배부 판관비) */
export function linkActualInputs(m: SgaLinkMonth, names: ChannelNames): ChannelInput[] {
  return m.channels
    .filter((c) => c.incentive || c.sga)
    .map((c) => ({ ...nameOf(names, c.ch), ym: m.ym, incentive: c.incentive, general: c.sga, rate: 0, updatedAt: '', updatedBy: SGA_ACTUAL_AUTHOR }));
}

/** ym 이전 마감월 중 가장 최근 n개 (오래된 달 → 최근) */
export function baseMonths(link: SgaLink, ym: string, n = SGA_BASE_MONTHS): SgaLinkMonth[] {
  return link.months.filter((m) => m.closed && m.ym < ym).sort((a, b) => a.ym.localeCompare(b.ym)).slice(-n);
}

export interface ChannelRatio {
  incentive: number; // 장려금 ÷ 매출
  sga: number; // 판관비 ÷ 매출
}

/** 채널별 비율. 기준 기간에 매출이 없던 채널은 전체 비율을 쓴다 */
export function channelRatios(base: SgaLinkMonth[]): { byCh: Map<string, ChannelRatio>; all: ChannelRatio } {
  const acc = new Map<string, { sales: number; incentive: number; sga: number }>();
  const all = { sales: 0, incentive: 0, sga: 0 };
  for (const m of base)
    for (const c of m.channels) {
      const k = stripCh(c.ch);
      const a = acc.get(k) ?? { sales: 0, incentive: 0, sga: 0 };
      a.sales += c.sales;
      a.incentive += c.incentive;
      a.sga += c.sga;
      acc.set(k, a);
      all.sales += c.sales;
      all.incentive += c.incentive;
      all.sga += c.sga;
    }
  const ratio = (a: { sales: number; incentive: number; sga: number }): ChannelRatio => ({ incentive: a.incentive / a.sales, sga: a.sga / a.sales });
  const byCh = new Map<string, ChannelRatio>();
  for (const [k, a] of acc) if (a.sales > 0) byCh.set(k, ratio(a));
  return { byCh, all: all.sales > 0 ? ratio(all) : { incentive: 0, sga: 0 } };
}

/**
 * 미마감 달 예측 입력. sales = 그 달 채널별 월 매출(당월은 월말 예상).
 * 마감 실적이 없으면 빈 목록 (그 달은 원장 대체 또는 수기 입력에 맡긴다).
 */
export function linkForecastInputs(link: SgaLink, ym: string, sales: { ch: string; cht: string; sales: number }[]): ChannelInput[] {
  const base = baseMonths(link, ym);
  if (!base.length) return [];
  const { byCh, all } = channelRatios(base);
  const out: ChannelInput[] = [];
  for (const s of sales) {
    if (s.sales <= 0) continue;
    const r = byCh.get(stripCh(s.ch)) ?? all;
    out.push({ ym, ch: s.ch, cht: s.cht, incentive: r.incentive * s.sales, general: 0, rate: r.sga * 100, updatedAt: '', updatedBy: SGA_FCST_AUTHOR });
  }
  return out;
}

/** 이 달을 판관비 대시보드 마감 실적으로 채울 수 있는가 */
export const closedLinkMonth = (link: SgaLink, ym: string) => link.months.find((m) => m.ym === ym && m.closed) ?? null;

/** 마감 실적이 있는 마지막 달 */
export const lastClosedYm = (link: SgaLink) => link.months.filter((m) => m.closed).reduce((a, m) => (m.ym > a ? m.ym : a), '');
