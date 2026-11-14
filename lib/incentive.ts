// 장려금 입력 시트 — 순수 계산 (2026-11-15 사용자 요청).
//   별도 구글 시트(INCENTIVE_SHEET_ID)를 DB로 쓴다. 탭 = 영업그룹, 행 = 월 × 고객그룹3 × 카테고리(product_map 카테고리).
//   열 10개(판매촉진비~진열장려금)를 모두 합친 금액이 그 칸의 장려금이다.
//   앱은 그 칸의 제품들에 매출 비중으로 배부한다 (lib/pnl.ts spreadChannelInputs, by 'cell').
//   시트 읽기·쓰기는 lib/incentive-sheet.ts
import type { ChannelFact, ChannelInput } from './types';

export const INCENTIVE_ITEMS = ['판매촉진비', '지급수수료', '광고선전비', '판매장려금', '대리점영업', '물류장려금', '발주장려금', '성장장려금', '입점장려금', '진열장려금'] as const;

/** 열: A 월 · B 영업그룹 · C 고객그룹3 · D 고객그룹명 · E 카테고리 · F~O 항목 10개 · P 합계(수식, 앱은 읽지 않는다) */
export const INCENTIVE_HEADER = ['YYYYMM', '영업그룹', '고객그룹3', '고객그룹명', '카테고리', ...INCENTIVE_ITEMS, '합계'] as const;
export const ITEM_COL = 5; // F열부터 항목
export const INCENTIVE_AUTHOR = '장려금 시트';
export const UNMAPPED_CAT = '(미매핑)';

type Cell = string | number;

export interface IncentiveCell {
  ch: string;
  cht: string;
  cat: string;
  sales: number;
}

export interface IncentiveGroup {
  sg: string;
  sgt: string;
  sales: number;
  cells: IncentiveCell[];
}

/**
 * 매출이 있는 영업그룹 × 고객그룹3 × 카테고리 조합. 영업그룹은 매출 큰 순,
 * 그 안에서 고객그룹3 매출 큰 순 → 카테고리 매출 큰 순. 매출 합이 0 이하인 조합은 뺀다.
 */
export function incentiveGroups(facts: ChannelFact[], catOf: (matnr: string) => string): IncentiveGroup[] {
  const groups = new Map<string, { sgt: string; chs: Map<string, { cht: string; cats: Map<string, number> }> }>();
  for (const f of facts) {
    if (!f.sg || !f.ch) continue;
    let g = groups.get(f.sg);
    if (!g) groups.set(f.sg, (g = { sgt: f.sgt || f.sg, chs: new Map() }));
    let c = g.chs.get(f.ch);
    if (!c) g.chs.set(f.ch, (c = { cht: f.cht || f.ch, cats: new Map() }));
    const cat = catOf(f.matnr) || UNMAPPED_CAT;
    c.cats.set(cat, (c.cats.get(cat) ?? 0) + f.sales);
  }
  const out: IncentiveGroup[] = [];
  for (const [sg, g] of groups) {
    const chs = [...g.chs].map(([ch, c]) => {
      const cells = [...c.cats]
        .filter(([, s]) => s > 0)
        .map(([cat, sales]) => ({ ch, cht: c.cht, cat, sales }))
        .sort((a, b) => b.sales - a.sales || a.cat.localeCompare(b.cat));
      return { sales: cells.reduce((s, x) => s + x.sales, 0), cells };
    });
    const cells = chs
      .filter((c) => c.cells.length)
      .sort((a, b) => b.sales - a.sales || a.cells[0].ch.localeCompare(b.cells[0].ch))
      .flatMap((c) => c.cells);
    if (cells.length) out.push({ sg, sgt: g.sgt, sales: cells.reduce((s, x) => s + x.sales, 0), cells });
  }
  return out.sort((a, b) => b.sales - a.sales || a.sg.localeCompare(b.sg));
}

/** 행 키 (월 · 영업그룹 · 고객그룹3 · 카테고리) */
export const recordKey = (ym: string, sg: string, ch: string, cat: string) => [ym, sg, ch, cat].join('|');

/** 시트 탭 이름: 영업그룹명. 시트가 허용하지 않는 문자는 빼고 100자 이내 */
export function tabTitle(sgt: string, sg: string): string {
  const t = sgt.replace(/[[\]*?:/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  return t || `영업그룹 ${sg}`;
}

export interface IncentiveRecord {
  ym: string;
  sg: string;
  sgt: string;
  ch: string;
  cht: string;
  cat: string;
  items: number[];
  total: number;
}

const str = (v: Cell | undefined) => (v == null ? '' : String(v).trim());
const num = (v: Cell | undefined) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replaceAll(',', '').trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * 탭 한 장의 데이터 행(헤더 제외) → 입력 기록. 영업그룹 열이 비면 그 행은 버린다.
 * 영업그룹명은 탭 이름으로 둔다. 같은 키가 두 번 나오면 금액을 더한다.
 */
export function parseIncentiveRows(rows: Cell[][], sgt: string): IncentiveRecord[] {
  const out = new Map<string, IncentiveRecord>();
  for (const v of rows) {
    const ym = str(v[0]);
    const sg = str(v[1]);
    const ch = str(v[2]);
    if (!/^\d{6}$/.test(ym) || !sg || !ch) continue;
    const cat = str(v[4]) || UNMAPPED_CAT;
    const items = INCENTIVE_ITEMS.map((_, i) => num(v[ITEM_COL + i]));
    const key = recordKey(ym, sg, ch, cat);
    const hit = out.get(key);
    if (hit) {
      hit.items = hit.items.map((x, i) => x + items[i]);
      hit.total = hit.items.reduce((s, x) => s + x, 0);
      continue;
    }
    out.set(key, { ym, sg, sgt, ch, cht: str(v[3]) || ch, cat, items, total: items.reduce((s, x) => s + x, 0) });
  }
  return [...out.values()];
}

/** 입력 기록 → 손익 배부 입력 (금액이 있는 칸만) */
export function recordsToInputs(recs: IncentiveRecord[]): ChannelInput[] {
  return recs
    .filter((r) => r.total)
    .map((r) => ({
      ym: r.ym,
      by: 'cell' as const,
      ch: r.ch,
      cht: r.cht,
      sg: r.sg,
      sgt: r.sgt,
      cat: r.cat,
      incentive: r.total,
      general: 0,
      rate: 0,
      updatedAt: '',
      updatedBy: INCENTIVE_AUTHOR,
    }));
}

/** 시트에 새로 붙일 행 (이미 있는 키는 뺀다). 코드·이름은 앞에 '를 붙여 문자 그대로 남긴다 ('01'이 1로 바뀌지 않게) */
export function newSheetRows(ym: string, g: IncentiveGroup, existing: Set<string>): Cell[][] {
  const text = (s: string) => `'${s}`;
  return g.cells
    .filter((c) => !existing.has(recordKey(ym, g.sg, c.ch, c.cat)))
    .map((c) => [Number(ym), text(g.sg), text(c.ch), text(c.cht), text(c.cat), ...INCENTIVE_ITEMS.map(() => ''), '=SUM(INDIRECT("F"&ROW()&":O"&ROW()))']);
}

/** 월 × 영업그룹 요약 (입력 화면 표) */
export interface IncentiveSummary {
  sg: string;
  sgt: string;
  rows: number;
  filled: number;
  total: number;
}

export function summarize(recs: IncentiveRecord[], ym: string): IncentiveSummary[] {
  const m = new Map<string, IncentiveSummary>();
  for (const r of recs) {
    if (r.ym !== ym) continue;
    const s = m.get(r.sg) ?? { sg: r.sg, sgt: r.sgt, rows: 0, filled: 0, total: 0 };
    s.rows += 1;
    if (r.total) s.filled += 1;
    s.total += r.total;
    m.set(r.sg, s);
  }
  return [...m.values()];
}
