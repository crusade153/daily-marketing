// SAP 실적 손익계산서 순수 계산 (관리자 시범). 수기 입력 없이 SAP 원천만 쓴다.
//   총매출·매출원가 = CO-PA (VV101, VV_COGS_A — 앱의 다른 화면과 같은 원천)
//   매출조정(장려금 등) = 회계원장 41xx (판매장려금·쿠폰·매출조정_기타). 차변(+)이 매출 차감
//   판관비 = 회계원장 61xx, 코스트센터(팀) 단위
//   순매출 = 총매출 − 매출조정,  GP = 순매출 − 매출원가,  OP = GP − 판관비.  이익률 분모는 순매출 (앱 공통)
// 계정 이름은 바뀐 적이 있어(접대비 → 업무추진비) 계정 번호 앞 6자리로 묶고, 이름은 가장 최근 전표의 이름을 쓴다.
// 마감 전인 달(당월)은 원장이 덜 들어와 있으므로 매출조정·판관비를 최근 마감 3개월 평균으로 추정한다.

import type { ChannelInput } from './types';

/** 원장 집계 한 줄: 월 × 계정 × 코스트센터 */
export interface GlRow {
  ym: string;
  acct: string;
  acctName: string; // 가장 최근 전표의 계정명 (예: '운반비_택배비')
  cc: string; // 코스트센터 ('' = 없음)
  ccName: string;
  amt: number;
}

/** closed = 마감 실적, provisional = 마감 중일 수 있는 전월, estimate = 진행 중인 달 (추정) */
export type LedgerKind = 'closed' | 'provisional' | 'estimate';

export interface LedgerMonth {
  ym: string;
  kind: LedgerKind;
}

export interface Line {
  key: string;
  label: string;
  values: number[]; // months 순서
}

export interface SgaGroup extends Line {
  items: Line[];
}

export interface Ledger {
  months: LedgerMonth[];
  sales: number[];
  cogs: number[];
  adj: Line[]; // 매출조정 계정별
  sga: SgaGroup[]; // 판관비 분류 → 계정 항목
  teams: Line[]; // 판관비 코스트센터별
  /** 추정 달에 원장에 이미 들어온 금액 (마감 전) */
  posted: { adj: number; sga: number } | null;
  /** 추정에 쓴 달 (YYYYMM) */
  basis: string[];
}

/** 판관비 분류: 계정 앞 6자리 → 분류. 목록에 없는 항목은 '기타 경비' */
export const SGA_GROUPS: { key: string; label: string; items: string[] }[] = [
  { key: 'people', label: '인건비', items: ['612010', '612020', '613001'] },
  { key: 'logistics', label: '물류비 (운반비)', items: ['613014'] },
  { key: 'marketing', label: '광고·판촉비', items: ['613024', '613025', '613023'] },
  { key: 'fees', label: '수수료', items: ['613018', '613026'] },
  { key: 'outsourcing', label: '외주용역비', items: ['613021'] },
  { key: 'assets', label: '감가상각·임차료', items: ['613008', '613020', '613009'] },
];
const OTHER_GROUP = { key: 'other', label: '기타 경비' };

export const isAdj = (acct: string) => acct.startsWith('41');
export const isSga = (acct: string) => acct.startsWith('61');
export const itemOf = (acct: string) => acct.slice(0, 6);

/** 계정명 '운반비_택배비' → 항목명 '운반비', '매출조정_판매장려금' → '판매장려금' */
export const itemLabel = (name: string) => name.split('_')[0] || name;
export const adjLabel = (name: string) => name.replace(/^매출조정_/, '') || name;

export function groupOfItem(item: string): { key: string; label: string } {
  return SGA_GROUPS.find((g) => g.items.includes(item)) ?? OTHER_GROUP;
}

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

/** months 밖의 달(추정 기준으로만 쓰는 이전 달)도 basisYms로 받아 평균을 낸다 */
export function buildLedger(params: {
  months: LedgerMonth[];
  sales: number[];
  cogs: number[];
  gl: GlRow[];
  /** 추정 기준 달 (최근 마감 3개월) */
  basisYms: string[];
}): Ledger {
  const { months, sales, cogs, gl, basisYms } = params;
  const idx = new Map(months.map((m, i) => [m.ym, i]));
  const est = months.findIndex((m) => m.kind === 'estimate');
  const zeros = () => months.map(() => 0);

  // 계정·팀별로 월 금액과 추정 기준 달 금액을 모은다
  type Acc = { label: string; values: number[]; basis: Map<string, number> };
  const accOf = (m: Map<string, Acc>, key: string, label: string) => {
    let a = m.get(key);
    if (!a) {
      a = { label, values: zeros(), basis: new Map() };
      m.set(key, a);
    }
    return a;
  };
  const adjAcc = new Map<string, Acc>();
  const itemAcc = new Map<string, Acc>();
  const teamAcc = new Map<string, Acc>();
  let postedAdj = 0;
  let postedSga = 0;
  const basisSet = new Set(basisYms);
  for (const r of gl) {
    const adj = isAdj(r.acct);
    if (!adj && !isSga(r.acct)) continue;
    const targets = adj
      ? [accOf(adjAcc, r.acct, adjLabel(r.acctName))]
      : [accOf(itemAcc, itemOf(r.acct), itemLabel(r.acctName)), accOf(teamAcc, r.cc || '-', r.cc ? r.ccName || r.cc : '(코스트센터 없음)')];
    const i = idx.get(r.ym);
    for (const a of targets) {
      if (i != null && i !== est) a.values[i] += r.amt;
      if (basisSet.has(r.ym)) a.basis.set(r.ym, (a.basis.get(r.ym) ?? 0) + r.amt);
    }
    if (i === est) {
      if (adj) postedAdj += r.amt;
      else postedSga += r.amt;
    }
  }
  // 추정 달: 기준 달 평균 (기준 달에 없던 계정은 0으로 본다)
  const finish = (a: Acc): number[] => {
    if (est < 0) return a.values;
    const v = [...a.values];
    v[est] = basisYms.length ? sum([...a.basis.values()]) / basisYms.length : 0;
    return v;
  };
  const lines = (m: Map<string, Acc>): Line[] =>
    [...m]
      .map(([key, a]) => ({ key, label: a.label, values: finish(a).map(Math.round) }))
      .filter((l) => l.values.some((v) => v !== 0))
      .sort((x, y) => Math.abs(sum(y.values)) - Math.abs(sum(x.values)));

  const items = lines(itemAcc);
  const groups = new Map<string, SgaGroup>();
  for (const it of items) {
    const g = groupOfItem(it.key);
    const grp = groups.get(g.key) ?? { key: g.key, label: g.label, values: zeros(), items: [] };
    grp.items.push(it);
    grp.values = grp.values.map((v, i) => v + it.values[i]);
    groups.set(g.key, grp);
  }
  const order = [...SGA_GROUPS.map((g) => g.key), OTHER_GROUP.key];
  return {
    months,
    sales: sales.map(Math.round),
    cogs: cogs.map(Math.round),
    adj: lines(adjAcc),
    sga: [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    teams: lines(teamAcc),
    posted: est >= 0 ? { adj: Math.round(postedAdj), sga: Math.round(postedSga) } : null,
    basis: basisYms,
  };
}

export interface Statement {
  sales: number;
  adj: number;
  net: number;
  cogs: number;
  gp: number;
  gpm: number | null;
  sga: number;
  op: number;
  opm: number | null;
}

/** i번째 달(또는 여러 달 합)의 손익 */
export function statementOf(l: Ledger, at: number[]): Statement {
  const pick = (v: number[]) => sum(at.map((i) => v[i] ?? 0));
  const sales = pick(l.sales);
  const adj = sum(l.adj.map((a) => pick(a.values)));
  const cogs = pick(l.cogs);
  const sga = sum(l.sga.map((g) => pick(g.values)));
  const net = sales - adj;
  const gp = net - cogs;
  const op = gp - sga;
  return { sales, adj, net, cogs, gp, gpm: net ? gp / net : null, sga, op, opm: net ? op / net : null };
}

/** 마감(잠정 포함) 달의 위치 */
export const closedIdx = (l: Pick<Ledger, 'months'>) => l.months.flatMap((m, i) => (m.kind === 'estimate' ? [] : [i]));

// ── 수기 입력이 없는 마감월의 장려금·일반비를 원장 실적으로 채우기 ──────────

/**
 * 대시보드 '일반비'에 해당하는 판관비 분류 (SGA_GROUPS 키): 물류비·광고판촉비·수수료.
 * 인건비·외주용역·감가상각 같은 공통비는 넣지 않는다 — 2026-10 수기 일반비 18.7억 ≈ 2026-09 원장 이 세 분류 17.6억.
 */
export const GENERAL_GROUPS = ['logistics', 'marketing', 'fees'];
export const GENERAL_ITEMS = SGA_GROUPS.filter((g) => GENERAL_GROUPS.includes(g.key)).flatMap((g) => g.items);

/** 원장 월 합계: adj = 매출조정(41xx, 장려금), general = GENERAL_ITEMS 판관비 */
export interface GlMonthCost {
  ym: string;
  adj: number;
  general: number;
}

export const LEDGER_AUTHOR = 'SAP 원장';

/**
 * 원장 월 합계를 그 달 채널(고객그룹3) 총매출 비중으로 나눠 채널 입력값처럼 만든다.
 * 그 뒤 제품 배부는 수기 입력과 같은 길(채널 안 제품 총매출 비중)을 탄다.
 * 매출이 0 이하인 채널은 받지 않는다. 원장 합계가 없는 달은 건너뛴다.
 */
export function ledgerInputs(costs: GlMonthCost[], salesByMonth: Map<string, { ch: string; cht: string; sales: number }[]>): ChannelInput[] {
  const out: ChannelInput[] = [];
  for (const c of costs) {
    const chs = new Map<string, { cht: string; sales: number }>();
    for (const f of salesByMonth.get(c.ym) ?? []) {
      const a = chs.get(f.ch) ?? { cht: f.cht, sales: 0 };
      a.sales += f.sales;
      chs.set(f.ch, a);
    }
    const pos = [...chs].filter(([, a]) => a.sales > 0);
    const total = pos.reduce((s, [, a]) => s + a.sales, 0);
    if (!total || (!c.adj && !c.general)) continue;
    for (const [ch, a] of pos) {
      const share = a.sales / total;
      out.push({ ym: c.ym, ch, cht: a.cht, incentive: c.adj * share, general: c.general * share, rate: 0, updatedAt: '', updatedBy: LEDGER_AUTHOR });
    }
  }
  return out;
}
