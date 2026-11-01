import 'server-only';
import { unstable_cache } from 'next/cache';
import { runQuery } from './bigquery';
import { getPeriods, kstToday, monthEnd, monthLabel, progressOf, shiftYm, yearStartOf, ymRange, type Periods } from './period';
import { applyCostBasis, applyLineOwners, buildMonthRows, buildRows, estimateFactsCogs, factsClosed, ORPHAN_NAME, type Axis } from './pnl';
import { MOMENTUM_AXES, momentum, opBridge, whaleCurve, type InsightData, type InsightPair } from './insight';
import { buildLedger, GENERAL_ITEMS, ledgerInputs, type GlMonthCost, type GlRow, type Ledger, type LedgerMonth } from './ledger';
import { buildPriceTrend, type PriceItem, type PriceTrend } from './price';
import { getStore, storageKind, TABS, type Cell } from './sheets';
import { SEG_PERIODS, type SegAmounts, type SegPeriod, type SegProduct } from './segment';
import { aggregateTrend, toMonthRows, type MonthBlock, type TrendData } from './trend';
import type {
  ChannelFact,
  ChannelInput,
  ChannelOwner,
  DailyFact,
  DashboardData,
  Hierarchy,
  LineOwner,
  MaterialFact,
  MaterialHist,
  MonthFact,
  MonthRow,
  ProductMap,
  Target,
  TargetMap,
} from './types';

// 원천: CO-PA (GL 대사 검증된 실제원가 VV_COGS_A, 총매출 VV101). 당월·전월·3개월 원가를 같은 원천으로 맞춘다.
// 표준원가 필드(VV_COGS_S, VV2xx)는 2026-04 이후 부풀려져 있어 쓰지 않는다.
// 쿼리 로직을 바꾸면 캐시 키 버전(v2)을 올린다.
const COPA = '`harimfood-361004.harim_sap_bi.CO_PA`';
const MARA = '`harimfood-361004.harim_sap_bi.SD_MARA`';
const KNVV = '`harimfood-361004.harim_sap_bi.SD_KNVV`';
const ACDOCA = '`harimfood-361004.harim_sap_bi.FI_ACDOCA`';
const COPA_FILTER = "c.VRGAR = 'F' AND c.PLIKZ = '0' AND c.BUKRS = '1000'";

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const str = (v: unknown) => (v == null ? '' : String(v).trim());

const UNSET = ' · 미지정';

/** 하위 레벨이 비었거나 상위 코드를 반복하면 상위 코드를 쓰고 이름은 "상위명 · 미지정" */
function level(code: string, name: string, parent: { code: string; label: string }) {
  if (!code || code === parent.code) {
    return { code: parent.code, label: parent.label.endsWith(UNSET) ? parent.label : `${parent.label}${UNSET}` };
  }
  return { code, label: name || code };
}

/** 품목·제품계층 LV1~LV4 (SD_MARA에 없으면 모든 레벨 미분류) */
function hier(r: Record<string, unknown>): Hierarchy & { matnr: string; name: string } {
  const base = { matnr: str(r.matnr), name: str(r.name) || str(r.matnr) };
  if (!str(r.l1)) {
    const u = { code: '-', label: '(미분류)' };
    return { ...base, l1: u.code, l1t: u.label, l2: u.code, l2t: u.label, l3: u.code, l3t: u.label, l4: u.code, l4t: u.label };
  }
  const a = { code: str(r.l1), label: str(r.l1t) || str(r.l1) };
  const b = level(str(r.l2), str(r.l2t), a);
  const c = level(str(r.l3), str(r.l3t), b);
  const d = level(str(r.l4), str(r.l4t), c);
  return { ...base, l1: a.code, l1t: a.label, l2: b.code, l2t: b.label, l3: c.code, l3t: c.label, l4: d.code, l4t: d.label };
}

const HIER_COLS = `t.MATNR_T AS name,
      t.PRDHA_1 AS l1, t.PRDHA_1_T AS l1t, t.PRDHA_2 AS l2, t.PRDHA_2_T AS l2t,
      t.PRDHA_3 AS l3, t.PRDHA_3_T AS l3t, t.PRDHA AS l4, t.PRDHA_T AS l4t`;

/** 당월·전월 + 당월 전 4개월 월별 값 (원가 마감 여부를 보고 그중 3개월을 원가 기준으로 고른다) */
async function queryMaterials(p: Periods): Promise<MaterialHist[]> {
  const hist = (col: string, as: string) => p.histYms.map((_, i) => `SUM(IF(ym = @h${i}, ${col}, 0)) AS ${as}${i}`).join(', ');
  const histCols = ['hq', 'hs', 'hg'].flatMap((k) => p.histYms.map((_, i) => `a.${k}${i}`)).join(', ');
  const rows = await runQuery<Record<string, unknown>>(
    `
    WITH base AS (
      SELECT c.ARTNR, c.BUDAT, SUBSTR(c.BUDAT, 1, 6) AS ym, c.ABSMG_EA AS q, c.VV101 AS s, c.VV_COGS_A AS g
      FROM ${COPA} c
      WHERE ${COPA_FILTER} AND c.BUDAT BETWEEN @histStart AND @today
    ),
    agg AS (
      SELECT ARTNR,
        SUM(IF(BUDAT BETWEEN @curStart AND @today, s, 0)) AS cur_sales,
        SUM(IF(BUDAT BETWEEN @curStart AND @today, q, 0)) AS cur_qty,
        SUM(IF(BUDAT BETWEEN @curStart AND @today, g, 0)) AS cur_cogs,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, s, 0)) AS prev_sales,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, q, 0)) AS prev_qty,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, g, 0)) AS prev_cogs,
        ${hist('q', 'hq')},
        ${hist('s', 'hs')},
        ${hist('g', 'hg')}
      FROM base
      GROUP BY ARTNR
    )
    SELECT a.ARTNR AS matnr, ${HIER_COLS},
      a.cur_sales, a.cur_qty, a.cur_cogs, a.prev_sales, a.prev_qty, a.prev_cogs, ${histCols}
    FROM agg a
    LEFT JOIN ${MARA} t ON t.MATNR = a.ARTNR
    `,
    {
      today: p.today,
      curStart: p.curStart,
      prevStart: p.prevStart,
      prevEnd: p.prevEnd,
      histStart: p.histStart,
      ...Object.fromEntries(p.histYms.map((ym, i) => [`h${i}`, ym])),
    },
  );
  const arr = (r: Record<string, unknown>, k: string) => p.histYms.map((_, i) => num(r[`${k}${i}`]));
  return rows
    .map((r) => ({
      ...hier(r),
      curSales: num(r.cur_sales),
      curQty: num(r.cur_qty),
      curCogs: num(r.cur_cogs),
      prevSales: num(r.prev_sales),
      prevQty: num(r.prev_qty),
      prevCogs: num(r.prev_cogs),
      histQty: arr(r, 'hq'),
      histSales: arr(r, 'hs'),
      histCogs: arr(r, 'hg'),
    }))
    .filter((f) => f.curSales || f.curQty || f.curCogs || f.prevSales || f.prevQty || f.prevCogs || [...f.histQty, ...f.histSales, ...f.histCogs].some(Boolean));
}

async function queryDaily(p: Periods): Promise<DailyFact[]> {
  const rows = await runQuery<Record<string, unknown>>(
    `
    SELECT c.BUDAT AS date, IFNULL(m.PRDHA_1_T, '(미분류)') AS l1t, SUM(c.VV101) AS sales
    FROM ${COPA} c
    LEFT JOIN ${MARA} m ON m.MATNR = c.ARTNR
    WHERE ${COPA_FILTER} AND c.BUDAT BETWEEN @prevStart AND @today
    GROUP BY 1, 2
    HAVING sales != 0
    ORDER BY 1
    `,
    { prevStart: p.prevStart, today: p.today },
  );
  return rows.map((r) => ({ date: str(r.date), l1t: str(r.l1t), sales: num(r.sales) }));
}

/** 캐시에 넣는 압축 형태: 월 목록 + 품목당 월 순서 배열 (캐시 항목 한도 2MB) */
interface MonthlyRaw {
  months: string[];
  items: (Hierarchy & { matnr: string; name: string; s: number[]; q: number[]; g: number[] })[];
}

/** 올해 1월 ~ 전월 품목별 월 실적 (매출·수량·실제원가) */
async function queryMonthly(p: Periods): Promise<MonthlyRaw> {
  const months = ymRange(yearStartOf(p.curYm), p.prevYm);
  if (!months.length) return { months, items: [] };
  const rows = await runQuery<Record<string, unknown>>(
    `
    WITH m AS (
      SELECT c.ARTNR, SUBSTR(c.BUDAT, 1, 6) AS ym, SUM(c.VV101) AS s, SUM(c.ABSMG_EA) AS q, SUM(c.VV_COGS_A) AS g
      FROM ${COPA} c
      WHERE ${COPA_FILTER} AND c.BUDAT BETWEEN @start AND @prevEnd
      GROUP BY 1, 2
      HAVING s != 0 OR q != 0 OR g != 0
    ),
    a AS (
      SELECT ARTNR,
        ARRAY_AGG(ym ORDER BY ym) AS yms,
        ARRAY_AGG(ROUND(s) ORDER BY ym) AS ss,
        ARRAY_AGG(ROUND(q, 3) ORDER BY ym) AS qs,
        ARRAY_AGG(ROUND(g) ORDER BY ym) AS gs
      FROM m
      GROUP BY ARTNR
    )
    SELECT a.ARTNR AS matnr, ${HIER_COLS}, a.yms, a.ss, a.qs, a.gs
    FROM a
    LEFT JOIN ${MARA} t ON t.MATNR = a.ARTNR
    `,
    { start: `${months[0]}01`, prevEnd: p.prevEnd },
  );
  const pos = new Map(months.map((ym, i) => [ym, i]));
  const items = rows.map((r) => {
    const zeros = () => months.map(() => 0);
    const it = { ...hier(r), s: zeros(), q: zeros(), g: zeros() };
    (r.yms as unknown[]).forEach((ym, j) => {
      const i = pos.get(str(ym));
      if (i == null) return;
      it.s[i] = num((r.ss as unknown[])[j]);
      it.q[i] = num((r.qs as unknown[])[j]);
      it.g[i] = num((r.gs as unknown[])[j]);
    });
    return it;
  });
  return { months, items };
}

function expandMonthly(raw: MonthlyRaw): MonthFact[] {
  return raw.items.map(({ s, q, g, ...h }) => {
    const sales: Record<string, number> = {};
    const qty: Record<string, number> = {};
    const cogs: Record<string, number> = {};
    raw.months.forEach((ym, i) => {
      if (s[i]) sales[ym] = s[i];
      if (q[i]) qty[ym] = q[i];
      if (g[i]) cogs[ym] = g[i];
    });
    return { ...h, sales, qty, cogs };
  });
}

const cachedMaterials = unstable_cache(async (today: string) => queryMaterials(getPeriods(today)), ['copa-materials-v3'], {
  revalidate: 3600,
  tags: ['bq'],
});

const cachedDaily = unstable_cache(async (today: string) => queryDaily(getPeriods(today)), ['copa-daily-v1'], {
  revalidate: 3600,
  tags: ['bq'],
});

const cachedMonthly = unstable_cache(async (today: string) => queryMonthly(getPeriods(today)), ['copa-monthly-v2'], {
  revalidate: 3600,
  tags: ['bq'],
});

/**
 * 제품 × 고객그룹3 월 실적 (매출·수량·실제원가). 고객그룹3은 SD_KNVV (고객·판매조직·유통경로).
 * CO-PA 고객(KNDNR)과 100% 연결됨 (2026-10-30 확인). 캐시 항목 한도(2MB) 때문에 6개월씩 나눠 담고
 * [제품 순번, 채널 순번, 월 순번, 매출, 수량, 원가] 숫자 배열로 줄인다.
 */
interface ChannelRaw {
  months: string[];
  mats: string[];
  chs: { code: string; name: string }[];
  rows: [number, number, number, number, number, number][];
}

const CHANNEL_CHUNK = 6;

/** 채널 실적이 필요한 달: 올해 1월(또는 1월이면 전월 12월) ~ 당월 */
function channelMonths(p: Periods): string[] {
  const start = yearStartOf(p.curYm);
  return ymRange(p.prevYm < start ? p.prevYm : start, p.curYm);
}

async function queryChannel(p: Periods, part: number): Promise<ChannelRaw> {
  const months = channelMonths(p).slice(part * CHANNEL_CHUNK, (part + 1) * CHANNEL_CHUNK);
  if (!months.length) return { months, mats: [], chs: [], rows: [] };
  const lastEnd = `${months[months.length - 1]}31`;
  const rows = await runQuery<Record<string, unknown>>(
    `
    WITH k AS (
      SELECT KUNNR, VKORG, VTWEG, ANY_VALUE(KVGR3) ch, ANY_VALUE(KVGR3_T) cht
      FROM ${KNVV} GROUP BY 1, 2, 3
    )
    SELECT IFNULL(c.ARTNR, '') AS matnr, SUBSTR(c.BUDAT, 1, 6) AS ym,
      IFNULL(NULLIF(k.ch, ''), '-') AS ch, ANY_VALUE(IFNULL(k.cht, '(미지정)')) AS cht,
      ROUND(SUM(c.VV101)) AS s, ROUND(SUM(c.ABSMG_EA), 3) AS q, ROUND(SUM(c.VV_COGS_A)) AS g
    FROM ${COPA} c
    LEFT JOIN k ON k.KUNNR = c.KNDNR AND k.VKORG = c.VKORG AND k.VTWEG = c.VTWEG
    WHERE ${COPA_FILTER} AND c.BUDAT BETWEEN @start AND @end
    GROUP BY 1, 2, 3
    HAVING s != 0 OR q != 0 OR g != 0
    `,
    { start: `${months[0]}01`, end: lastEnd < p.today ? lastEnd : p.today },
  );
  const matIdx = new Map<string, number>();
  const chIdx = new Map<string, number>();
  const raw: ChannelRaw = { months, mats: [], chs: [], rows: [] };
  for (const r of rows) {
    const matnr = str(r.matnr);
    let pi = matIdx.get(matnr);
    if (pi == null) {
      pi = raw.mats.push(matnr) - 1;
      matIdx.set(matnr, pi);
    }
    const code = str(r.ch);
    let ci = chIdx.get(code);
    if (ci == null) {
      ci = raw.chs.push({ code, name: str(r.cht) || code }) - 1;
      chIdx.set(code, ci);
    }
    const mi = months.indexOf(str(r.ym));
    if (mi >= 0) raw.rows.push([pi, ci, mi, num(r.s), num(r.q), num(r.g)]);
  }
  return raw;
}

const cachedChannel = unstable_cache(async (today: string, part: number) => queryChannel(getPeriods(today), part), ['copa-channel-v2'], {
  revalidate: 3600,
  tags: ['bq'],
});

/** 월 → 제품 × 채널 실적 */
async function getChannelFacts(today: string): Promise<Map<string, ChannelFact[]>> {
  const p = getPeriods(today);
  const months = channelMonths(p);
  const parts = Math.ceil(months.length / CHANNEL_CHUNK);
  const raws = await Promise.all(Array.from({ length: parts }, (_, i) => cachedChannel(p.today, i)));
  const out = new Map<string, ChannelFact[]>(months.map((m) => [m, []]));
  for (const raw of raws) {
    for (const [pi, ci, mi, sales, qty, cogs] of raw.rows) {
      const ch = raw.chs[ci];
      out.get(raw.months[mi])?.push({ matnr: raw.mats[pi], ch: ch.code, cht: ch.name, sales, qty, cogs });
    }
  }
  return out;
}

/** 입력 화면용: 고객그룹3별 월 매출 (마감월 실적, 당월 누계) */
export async function getChannelTotals(today?: string) {
  const p = getPeriods(today);
  const facts = await getChannelFacts(p.today);
  const items = new Map<string, { code: string; name: string; sales: Record<string, number> }>();
  for (const [ym, list] of facts) {
    for (const f of list) {
      const it = items.get(f.ch) ?? { code: f.ch, name: f.cht, sales: {} };
      it.sales[ym] = (it.sales[ym] ?? 0) + f.sales;
      items.set(f.ch, it);
    }
  }
  return [...items.values()];
}

// ── 시트(수기 데이터) ──────────────────────────────────────────

const toNum = (v: Cell | undefined) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replaceAll(',', '').trim());
  return Number.isFinite(n) ? n : 0;
};
/** 수식 오류(#N/A 등)는 빈칸으로 본다 */
const toStr = (v: Cell | undefined) => {
  const s = v == null ? '' : String(v).trim();
  return /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|ERROR!)/.test(s) ? '' : s;
};

async function readProductMap(): Promise<ProductMap[]> {
  const rows = await getStore().read(TABS.productMap);
  // 헤더 행(첫 칸 MATNR)이 데이터 위쪽에 있으면 그 이름으로 열을 찾는다. 없으면 TABS 순서
  const head = rows.slice(0, 5).find((r) => toStr(r.values[0]) === 'MATNR');
  const names: string[] = head ? head.values.map(toStr) : [...TABS.productMap.header];
  // 정확히 같은 이름 → 그 이름으로 시작하는 열 순서로 찾는다 (예: '카테고리 (2LV)'). 헤더에 없는 열은 -1 → 빈칸
  const find = (n: string) => {
    const exact = names.indexOf(n);
    return exact >= 0 ? exact : names.findIndex((h) => h.startsWith(n));
  };
  const [cMat, cName, c1, c2, c3, cEtc, cCat, cOwner] = ['MATNR', '제품명', 'CM1', 'CM2', 'CM3', '기타', '카테고리', '담당자'].map(find);
  return rows
    .filter((r) => r !== head)
    .map(({ values: v }) => ({
      matnr: toStr(v[cMat]),
      name: toStr(v[cName]),
      cm1: toStr(v[c1]),
      cm2: toStr(v[c2]),
      cm3: toStr(v[c3]),
      etc: toStr(v[cEtc]),
      category: toStr(v[cCat]),
      owner: toStr(v[cOwner]),
    }))
    .filter((m) => m.matnr && m.matnr !== 'MATNR');
}

// 시트를 직접 고친 경우를 위해 5분 주기로도 갱신. 앱에서 저장하면 updateTag('manual')로 즉시 갱신.
export const getProductMap = unstable_cache(readProductMap, ['product-map-v3'], { revalidate: 300, tags: ['manual'] });

async function readLineOwners(): Promise<LineOwner[]> {
  const rows = await getStore().read(TABS.lineOwner);
  return rows
    .map(({ values: v }) => ({
      line: toStr(v[0]),
      cm: toStr(v[1]),
      pm: toStr(v[2]),
      updatedAt: toStr(v[3]),
      updatedBy: toStr(v[4]),
    }))
    .filter((l) => l.line);
}
export const getLineOwners = unstable_cache(readLineOwners, ['line-owner-v1'], { revalidate: 300, tags: ['manual'] });

async function readChannelOwners(): Promise<ChannelOwner[]> {
  const rows = await getStore().read(TABS.channelOwner);
  return rows
    .map(({ values: v }) => ({
      ch: toStr(v[0]),
      cht: toStr(v[1]),
      rep: toStr(v[2]),
      updatedAt: toStr(v[3]),
      updatedBy: toStr(v[4]),
    }))
    .filter((c) => c.ch);
}
export const getChannelOwners = unstable_cache(readChannelOwners, ['channel-owner-v1'], { revalidate: 300, tags: ['manual'] });

/** 채널 → 영업담당자 */
async function getRepMap(): Promise<Map<string, string>> {
  return new Map((await getChannelOwners()).filter((c) => c.rep).map((c) => [c.ch, c.rep]));
}

async function readChannelInputs(): Promise<ChannelInput[]> {
  // 열: YYYYMM · 고객그룹3 · 고객그룹3명 · 장려금 · 수정일시 · 수정자 · 일반비 고정비 · 일반비 변동비율(%) (뒤 두 열은 나중에 추가)
  const rows = await getStore().read(TABS.channelInput);
  return rows
    .map(({ values: v }) => ({
      ym: toStr(v[0]),
      ch: toStr(v[1]),
      cht: toStr(v[2]),
      incentive: toNum(v[3]),
      updatedAt: toStr(v[4]),
      updatedBy: toStr(v[5]),
      general: toNum(v[6]),
      rate: toNum(v[7]),
    }))
    .filter((c) => c.ym && c.ch);
}
export const getChannelInputs = unstable_cache(readChannelInputs, ['manual-input-channel-v3'], { revalidate: 300, tags: ['manual'] });

async function readTargets(): Promise<Target[]> {
  const rows = await getStore().read(TABS.target);
  return rows
    .map(({ values: v }) => ({
      ym: toStr(v[0]).replace(/\D/g, '').slice(0, 6),
      matnr: toStr(v[1]),
      sales: toNum(v[3]),
      gp: toNum(v[4]),
      op: toNum(v[5]),
    }))
    .filter((t) => t.ym.length === 6 && t.matnr);
}
export const getTargets = unstable_cache(readTargets, ['target-product-v1'], { revalidate: 300, tags: ['manual'] });

/** 그 달 제품 목표 (같은 제품이 여러 줄이면 합산) */
export function targetMapOf(targets: Target[], ym: string): TargetMap {
  const out: TargetMap = {};
  for (const t of targets) {
    if (t.ym !== ym) continue;
    const v = out[t.matnr] ?? [0, 0, 0];
    v[0] += t.sales;
    v[1] += t.gp;
    v[2] += t.op;
    out[t.matnr] = v;
  }
  return out;
}

/** 손익 계산에 쓰는 품목 매핑: 시트 product_map + 제품라인·CM 표시별 CM·PM 이름 */
async function getEffectiveMap(): Promise<ProductMap[]> {
  const [maps, lines] = await Promise.all([getProductMap(), getLineOwners()]);
  return applyLineOwners(maps, lines);
}

// ── 수기 입력이 없는 마감월: 장려금·일반비 = SAP 원장 실적 ─────────────

/** 원장으로 채울 수 있는 달: 채널 실적 범위 중 원장 마감이 끝난 달 (전월은 15일부터, lib/data.ts ledgerBasis) */
function glMonths(p: Periods): string[] {
  const last = shiftYm(p.curYm, ledgerBasis(p).provisional ? -2 : -1);
  return channelMonths(p).filter((ym) => ym <= last);
}

/** 월 합계만 읽어 원장 손익 쿼리(1.2GB)보다 가볍다 (0.5GB). 마감월만 쓰므로 6시간 캐시 */
async function queryGlCosts(start: string, end: string): Promise<GlMonthCost[]> {
  const items = GENERAL_ITEMS.map((i) => `'${i}'`).join(', ');
  const rows = await runQuery<Record<string, unknown>>(
    `
    SELECT SUBSTR(BUDAT, 1, 6) AS ym,
      ROUND(SUM(IF(STARTS_WITH(RACCT, '41'), HSL, 0))) AS adj,
      ROUND(SUM(IF(SUBSTR(RACCT, 1, 6) IN (${items}), HSL, 0))) AS general
    FROM ${ACDOCA}
    WHERE RBUKRS = '1000' AND (STARTS_WITH(RACCT, '41') OR STARTS_WITH(RACCT, '61')) AND BUDAT BETWEEN @start AND @end
    GROUP BY 1
    `,
    { start: `${start}01`, end: monthEnd(end) },
  );
  return rows.map((r) => ({ ym: str(r.ym), adj: num(r.adj), general: num(r.general) }));
}

const cachedGlCosts = unstable_cache(queryGlCosts, ['gl-costs-v1'], { revalidate: 21600, tags: ['bq'] });

async function getGlCosts(p: Periods): Promise<GlMonthCost[]> {
  const months = glMonths(p);
  return months.length ? cachedGlCosts(months[0], months[months.length - 1]) : [];
}

/**
 * 손익 계산에 쓰는 채널 비용 = 수기 입력 + 수기 입력이 하나도 없는 마감월의 원장 실적.
 * 한 채널이라도 입력한 달은 수기 값만 쓴다 (섞으면 어디까지가 원장인지 알 수 없다).
 */
function withLedgerCosts(manual: ChannelInput[], gl: GlMonthCost[], chFacts: Map<string, ChannelFact[]>) {
  const costs = gl.filter((c) => !filledCount(manual, c.ym));
  const filled = ledgerInputs(costs, chFacts);
  return { inputs: [...manual, ...filled], ledgerYms: [...new Set(filled.map((i) => i.ym))] };
}

/**
 * 원가 결산 전인 지난달(당월 제외)은 CO-PA 원가가 거의 0이라 실적 이익이 부풀려 보인다.
 * 그 달 원가를 당월 예상과 같은 방식(원가 기준 3개월 단위원가)으로 추정해 넣는다.
 */
function withEstimatedCogs(chFacts: Map<string, ChannelFact[]>, facts: MaterialFact[], curYm: string) {
  const out = new Map(chFacts);
  const estYms: string[] = [];
  for (const [ym, list] of chFacts) {
    if (ym >= curYm || !list.length || factsClosed(list)) continue;
    out.set(ym, estimateFactsCogs(list, facts));
    estYms.push(ym);
  }
  return { chFacts: out, estYms };
}

// ── 대시보드 조립 ──────────────────────────────────────────────

export async function getFacts(today?: string) {
  const p = getPeriods(today);
  return { periods: p, ...applyCostBasis(await cachedMaterials(p.today), p.histYms) };
}

const filledCount = (inputs: ChannelInput[], ym: string) => inputs.filter((i) => i.ym === ym && (i.incentive || i.general || i.rate)).length;
const channelCount = (rows: { ch: string; name: string }[], sales: (r: { ch: string; name: string }) => number) =>
  new Set(rows.filter((r) => r.name !== ORPHAN_NAME && sales(r)).map((r) => r.ch)).size;

export async function getDashboard(today?: string): Promise<DashboardData> {
  const p = getPeriods(today);
  const [hist, daily, maps, manual, rawChFacts, reps, targets, gl] = await Promise.all([
    cachedMaterials(p.today),
    cachedDaily(p.today),
    getEffectiveMap(),
    getChannelInputs(),
    getChannelFacts(p.today),
    getRepMap(),
    getTargets(),
    getGlCosts(p),
  ]);
  const { facts, costYms, prevClosed, curClosed } = applyCostBasis(hist, p.histYms);
  const { chFacts, estYms } = withEstimatedCogs(rawChFacts, facts, p.curYm);
  const { inputs, ledgerYms } = withLedgerCosts(manual, gl, chFacts);
  // 진행 중인 당월은 당연히 마감 전이라 알리지 않는다. 지난달을 당월로 보는 화면(?ym)에서만 알린다
  const live = p.curYm === kstToday().slice(0, 6);
  const costOpen = [...(prevClosed ? [] : [p.prevYm]), ...(live || curClosed ? [] : [p.curYm])];

  const curDates = daily.filter((d) => d.date >= p.curStart).map((d) => d.date);
  const dataDate = curDates.length ? curDates.reduce((a, b) => (a > b ? a : b)) : null;
  const progress = progressOf(dataDate, p.daysInMonth);

  const curInputs = inputs.filter((i) => i.ym === p.curYm);
  const prevInputs = inputs.filter((i) => i.ym === p.prevYm);
  const rows = buildRows({
    facts,
    cur: chFacts.get(p.curYm) ?? [],
    prev: chFacts.get(p.prevYm) ?? [],
    maps,
    reps,
    curInputs,
    prevInputs,
    elapsed: progress.elapsed,
    daysInMonth: p.daysInMonth,
  }).filter((r) => r.mtd.sales || r.prev.sales || r.prev.cogs || r.fcst.incentive || r.fcst.general || r.prev.incentive || r.prev.general);

  const coverage = { unitSales: 0, rateSales: 0, noneSales: 0 };
  for (const r of rows) {
    if (r.costMethod === 'unit') coverage.unitSales += r.mtd.sales;
    else if (r.costMethod === 'rate') coverage.rateSales += r.mtd.sales;
    else coverage.noneSales += r.mtd.sales;
  }

  return {
    curYm: p.curYm,
    prevYm: p.prevYm,
    costYms,
    costOpen,
    costEstYms: estYms,
    dataDate,
    progress,
    rows,
    coverage,
    inputStatus: {
      chTotal: new Set(rows.filter((r) => r.name !== ORPHAN_NAME && (r.mtd.sales || r.prev.sales)).map((r) => r.ch)).size,
      curFilled: filledCount(inputs, p.curYm),
      prevFilled: filledCount(inputs, p.prevYm),
    },
    ledgerYms,
    targets: { cur: targetMapOf(targets, p.curYm), prev: targetMapOf(targets, p.prevYm) },
    storage: storageKind(),
  };
}

// ── 월별 (올해 1월 ~ 당월) ─────────────────────────────────────

/** 마감월은 CO-PA 실적 + 그 달 채널 입력값, 당월은 대시보드의 월 예상. 대시보드 '전월'과 겹치는 달은 같은 원천이라 값이 같다. */
export async function getMonthBlocks(today?: string) {
  const p = getPeriods(today);
  const closed = ymRange(yearStartOf(p.curYm), p.prevYm);
  const [d, monthly, maps, manual, rawChFacts, reps, gl, { facts }] = await Promise.all([
    getDashboard(today),
    closed.length ? cachedMonthly(p.today).then(expandMonthly) : Promise.resolve([] as MonthFact[]),
    getEffectiveMap(),
    getChannelInputs(),
    getChannelFacts(p.today),
    getRepMap(),
    getGlCosts(p),
    getFacts(today),
  ]);
  const { chFacts, estYms } = withEstimatedCogs(rawChFacts, facts, p.curYm);
  const { inputs } = withLedgerCosts(manual, gl, chFacts);
  const dims = new Map(monthly.map((f) => [f.matnr, f]));

  const blocks: MonthBlock[] = closed.map((ym) => {
    const rows = buildMonthRows({ facts: chFacts.get(ym) ?? [], dims, maps, reps, inputs: inputs.filter((i) => i.ym === ym) });
    return { ym, kind: 'actual', rows, filled: filledCount(inputs, ym), chTotal: channelCount(rows, (r) => (r as MonthRow).amt.sales), ledger: d.ledgerYms.includes(ym) || undefined, costEst: estYms.includes(ym) || undefined };
  });
  const curRows = toMonthRows(d.rows, 'fcst');
  blocks.push({
    ym: p.curYm,
    kind: 'fcst',
    rows: curRows,
    filled: filledCount(inputs, p.curYm),
    chTotal: channelCount(curRows, (r) => (r as MonthRow).amt.sales),
  });
  return { d, blocks, inputs, monthly };
}

export async function getTrend(axis: Axis, today?: string): Promise<TrendData> {
  const { d, blocks } = await getMonthBlocks(today);
  return {
    axis,
    months: blocks.map(({ ym, kind, filled, chTotal, ledger, costEst }) => ({ ym, kind, filled, chTotal, ledger, costEst })),
    ...aggregateTrend(blocks, axis),
    dataDate: d.dataDate,
  };
}

/** 판매단가 추이: 마감월은 월 실적, 당월은 누계(진행 중) 기준. 그룹은 제품계층 LV1 */
export async function getPriceTrend(today?: string): Promise<PriceTrend> {
  const { d, blocks, monthly } = await getMonthBlocks(today);
  const months = blocks.map((b) => ({ ym: b.ym, partial: b.kind === 'fcst' }));
  const closed = months.filter((m) => !m.partial).map((m) => m.ym);
  const items = new Map<string, PriceItem>();
  const labels = new Map<string, string>();
  const item = (matnr: string, l1: string) => {
    let it = items.get(matnr);
    if (!it) {
      it = { key: l1, sales: months.map(() => 0), qty: months.map(() => 0) };
      items.set(matnr, it);
    }
    return it;
  };
  for (const f of monthly) {
    labels.set(f.l1, f.l1t);
    const it = item(f.matnr, f.l1);
    closed.forEach((ym, i) => {
      it.sales[i] = f.sales[ym] ?? 0;
      it.qty[i] = f.qty[ym] ?? 0;
    });
  }
  const cur = months.length - 1;
  // 당월 행은 제품 × 채널이므로 제품별로 더한다
  for (const r of d.rows) {
    if (r.name === ORPHAN_NAME) continue;
    labels.set(r.l1, r.l1t);
    const it = item(r.matnr, r.l1);
    it.sales[cur] += r.mtd.sales;
    it.qty[cur] += r.mtd.qty;
  }
  return buildPriceTrend(months, [...items.values()], labels);
}

// ── 세그먼트(ABCD 매트릭스) ───────────────────────────────────

export interface SegmentData {
  products: SegProduct[];
  periods: { id: SegPeriod; label: string; costNote: string | null; compareOnly?: boolean }[];
  /** 채널 필터 목록 (올해 매출 큰 순) */
  channels: { code: string; name: string }[];
  channel: string | null;
  dataDate: string | null;
}

/**
 * 제품별 기간 금액: 올해 누계(마감월 실적 + 당월 예상), 당월 예상, 전월 실적, 전전월 실적(비교 기준).
 * channel을 주면 그 고객그룹3 매출·비용만 모은다 (화면 전달량을 줄이려고 서버에서 거른다).
 */
export async function getSegment(channel?: string | null, today?: string): Promise<SegmentData> {
  const { d, blocks } = await getMonthBlocks(today);
  const n = blocks.length;
  const prev2 = n >= 3 ? blocks[n - 3] : null;
  const map = new Map<string, SegProduct>();
  const chSales = new Map<string, { name: string; sales: number }>();
  const zero = (): SegAmounts => [0, 0, 0, 0, 0];
  const at = (r: MonthRow) => {
    let p = map.get(r.matnr);
    if (!p) {
      const { matnr, name, cm, cmMark, owner, category, l1t } = r;
      p = { matnr, name, cm, cmMark, owner, category, l1t, a: SEG_PERIODS.map(zero) };
      map.set(r.matnr, p);
    }
    return p;
  };
  const add = (r: MonthRow, period: SegPeriod) => {
    if (r.name === ORPHAN_NAME) return;
    if (period === 'ytd') {
      const c = chSales.get(r.ch) ?? { name: r.cht, sales: 0 };
      c.sales += r.amt.sales;
      chSales.set(r.ch, c);
    }
    if (channel && r.ch !== channel) return;
    const v = at(r).a[SEG_PERIODS.indexOf(period)];
    v[0] += r.amt.sales;
    v[1] += r.amt.qty;
    v[2] += r.amt.cogs;
    v[3] += r.amt.incentive;
    v[4] += r.amt.general;
  };
  for (const b of blocks) for (const r of b.rows) add(r, 'ytd');
  for (const r of toMonthRows(d.rows, 'fcst')) add(r, 'fcst');
  for (const r of toMonthRows(d.rows, 'prev')) add(r, 'prev');
  if (prev2) for (const r of prev2.rows) add(r, 'prev2');

  // 화면 전달량을 줄이려고 원 단위로 반올림 (예상치는 소수가 길다)
  const products = [...map.values()]
    .map((p) => ({ ...p, a: p.a.map((v) => v.map(Math.round) as SegAmounts) }))
    .filter((p) => p.a.some((v) => v[0] || v[2]));

  const cur = blocks[n - 1];
  const prevBlock = n >= 2 ? blocks[n - 2] : null;
  const note = (b: MonthBlock | null) =>
    b && b.filled < b.chTotal ? `${monthLabel(b.ym)} 장려금·일반비 ${b.filled}/${b.chTotal}개 채널 입력` : null;
  const ytdMissing = blocks.filter((b) => b.filled === 0).length;
  return {
    products,
    periods: [
      {
        id: 'ytd',
        label: `올해 누계 (${monthLabel(blocks[0].ym)}~${monthLabel(cur.ym)} 예상)`,
        costNote: ytdMissing ? `장려금·일반비 미입력 ${ytdMissing}/${n}개월` : null,
      },
      { id: 'fcst', label: `${monthLabel(d.curYm)} 예상`, costNote: note(cur) },
      { id: 'prev', label: `${monthLabel(d.prevYm)} 실적`, costNote: note(prevBlock) },
      ...(prev2 ? [{ id: 'prev2' as const, label: `${monthLabel(prev2.ym)} 실적`, costNote: note(prev2), compareOnly: true }] : []),
    ],
    channels: [...chSales].sort((a, b) => b[1].sales - a[1].sales).map(([code, c]) => ({ code, name: c.name })),
    channel: channel ?? null,
    dataDate: d.dataDate,
  };
}

// ── 손익 인사이트 (관리자 시범) ────────────────────────────────

/** 비교 기간 선택지 수 (최근 월부터) */
const INSIGHT_PAIRS = 3;

/** 영업이익 브리지·성장 품질은 이웃한 두 달씩, 고래곡선은 당월 예상·전월 실적·올해 누계 */
export async function getInsights(today?: string): Promise<InsightData> {
  const { d, blocks } = await getMonthBlocks(today);
  // 1월에는 마감월이 없으므로 대시보드의 전월 실적을 앞에 붙인다
  const seq: MonthBlock[] =
    blocks.length >= 2
      ? blocks
      : [{ ym: d.prevYm, kind: 'actual', rows: toMonthRows(d.rows, 'prev'), filled: d.inputStatus.prevFilled, chTotal: d.inputStatus.chTotal }, ...blocks];
  const n = seq.length;
  const label = (b: MonthBlock) => `${monthLabel(b.ym)} ${b.kind === 'fcst' ? '예상' : '실적'}`;

  const pairs: InsightPair[] = [];
  for (let i = n - 1; i >= 1 && pairs.length < INSIGHT_PAIRS; i--) {
    const b0 = seq[i - 1];
    const b1 = seq[i];
    pairs.push({
      id: `${b0.ym}-${b1.ym}`,
      baseLabel: label(b0),
      curLabel: label(b1),
      fcst: b1.kind === 'fcst',
      coverage: [b0, b1].filter((b) => b.filled < b.chTotal).map((b) => `${monthLabel(b.ym)} ${b.filled}/${b.chTotal}개 채널`),
      bridge: opBridge(b0.rows, b1.rows),
      momentum: Object.fromEntries(
        MOMENTUM_AXES.map((a) => [a, { net: momentum(b0.rows, b1.rows, a), pre: momentum(b0.rows, b1.rows, a, true) }]),
      ) as InsightPair['momentum'],
    });
  }

  const last = seq[n - 1];
  const whale = (id: string, text: string, rows: MonthRow[]) => ({ id, label: text, gp: whaleCurve(rows, 'gp'), op: whaleCurve(rows, 'op') });
  return {
    pairs,
    whales: [
      whale('cur', label(last), last.rows),
      whale('prev', label(seq[n - 2]), seq[n - 2].rows),
      whale('ytd', `올해 누계 (${monthLabel(blocks[0].ym)}~${monthLabel(last.ym)})`, blocks.flatMap((b) => b.rows)),
    ],
    opReady: last.filled > 0,
    dataDate: d.dataDate,
  };
}

// ── SAP 실적 손익계산서 (회계원장, 관리자 시범) ───────────────────

/** 전월 결산이 끝나기 전(매월 15일 이전)에는 전월을 잠정으로 본다 */
const CLOSE_DAY = 15;

/**
 * 추정 기준 = 최근 마감 3개월. 전월이 잠정이면 그 전 3개월.
 * 원장 조회는 올해 1월과 추정 기준 첫 달 중 이른 달부터.
 */
function ledgerBasis(p: Periods): { provisional: boolean; basis: string[]; start: string } {
  const provisional = Number(p.today.slice(6, 8)) < CLOSE_DAY;
  const last = shiftYm(p.curYm, provisional ? -2 : -1);
  const basis = [shiftYm(last, -2), shiftYm(last, -1), last];
  const y = yearStartOf(p.curYm);
  return { provisional, basis, start: basis[0] < y ? basis[0] : y };
}

/** 캐시 항목 한도(2MB) 때문에 [월, 계정, 코스트센터, 금액] 순번 배열로 줄인다 */
interface GlRaw {
  months: string[];
  accts: [string, string][]; // [계정, 최근 계정명]
  ccs: [string, string][]; // [코스트센터, 최근 이름]
  rows: [number, number, number, number][];
}

async function queryLedger(p: Periods): Promise<GlRaw> {
  const { start } = ledgerBasis(p);
  const rows = await runQuery<Record<string, unknown>>(
    `
    WITH b AS (
      SELECT BUDAT, RACCT, TXT50, RCNTR, LTEXT_C, HSL
      FROM ${ACDOCA}
      WHERE RBUKRS = '1000' AND (STARTS_WITH(RACCT, '41') OR STARTS_WITH(RACCT, '61')) AND BUDAT BETWEEN @start AND @today
    ),
    g AS (
      SELECT SUBSTR(BUDAT, 1, 6) AS ym, RACCT, IFNULL(RCNTR, '') AS cc, ROUND(SUM(HSL)) AS amt
      FROM b GROUP BY 1, 2, 3 HAVING amt != 0
    ),
    a AS (SELECT RACCT, ARRAY_AGG(TXT50 ORDER BY BUDAT DESC LIMIT 1)[OFFSET(0)] AS txt FROM b GROUP BY 1),
    c AS (SELECT RCNTR, ARRAY_AGG(LTEXT_C ORDER BY BUDAT DESC LIMIT 1)[OFFSET(0)] AS nm FROM b WHERE RCNTR IS NOT NULL GROUP BY 1)
    SELECT g.ym, g.RACCT AS acct, g.cc, g.amt, a.txt, c.nm
    FROM g LEFT JOIN a USING (RACCT) LEFT JOIN c ON c.RCNTR = g.cc
    `,
    { start: `${start}01`, today: p.today },
  );
  const raw: GlRaw = { months: [], accts: [], ccs: [], rows: [] };
  const mi = new Map<string, number>();
  const ai = new Map<string, number>();
  const ci = new Map<string, number>();
  const at = <T>(m: Map<string, number>, list: T[], key: string, make: () => T) => {
    let i = m.get(key);
    if (i == null) {
      i = list.push(make()) - 1;
      m.set(key, i);
    }
    return i;
  };
  for (const r of rows) {
    const acct = str(r.acct);
    const cc = str(r.cc);
    raw.rows.push([
      at(mi, raw.months, str(r.ym), () => str(r.ym)),
      at(ai, raw.accts, acct, () => [acct, str(r.txt)]),
      at(ci, raw.ccs, cc, () => [cc, str(r.nm)]),
      num(r.amt),
    ]);
  }
  return raw;
}

const cachedLedger = unstable_cache(async (today: string) => queryLedger(getPeriods(today)), ['gl-ledger-v1'], {
  revalidate: 3600,
  tags: ['bq'],
});

export type LedgerData = Ledger & { dataDate: string | null };

/** 올해 1월 ~ 당월. 총매출·매출원가는 월별 추이와 같은 원천(마감월 CO-PA 실적, 당월은 월말 예상) */
export async function getLedger(today?: string): Promise<LedgerData> {
  const p = getPeriods(today);
  const { provisional, basis } = ledgerBasis(p);
  const [{ d, blocks }, raw] = await Promise.all([getMonthBlocks(today), cachedLedger(p.today)]);
  const months: LedgerMonth[] = blocks.map((b) => ({
    ym: b.ym,
    kind: b.kind === 'fcst' ? 'estimate' : b.ym === p.prevYm && provisional ? 'provisional' : 'closed',
  }));
  const total = (b: MonthBlock, k: 'sales' | 'cogs') => b.rows.reduce((s, r) => s + r.amt[k], 0);
  const gl: GlRow[] = raw.rows.map(([m, a, c, amt]) => ({
    ym: raw.months[m],
    acct: raw.accts[a][0],
    acctName: raw.accts[a][1],
    cc: raw.ccs[c][0],
    ccName: raw.ccs[c][1],
    amt,
  }));
  return {
    ...buildLedger({ months, sales: blocks.map((b) => total(b, 'sales')), cogs: blocks.map((b) => total(b, 'cogs')), gl, basisYms: basis }),
    dataDate: d.dataDate,
  };
}
