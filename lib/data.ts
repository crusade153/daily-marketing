import 'server-only';
import { unstable_cache } from 'next/cache';
import { runQuery } from './bigquery';
import { getPeriods, monthLabel, progressOf, yearStartOf, ymRange, type Periods } from './period';
import { buildMonthRows, buildRows, ORPHAN_NAME, type Axis } from './pnl';
import { buildPriceTrend, type PriceItem, type PriceTrend } from './price';
import { getStore, storageKind, TABS, type Cell } from './sheets';
import { SEG_PERIODS, type SegPeriod, type SegProduct } from './segment';
import { aggregateTrend, toMonthRows, type MonthBlock, type TrendData } from './trend';
import type { DailyFact, DashboardData, Hierarchy, ManualInput, MaterialFact, MonthFact, MonthRow, ProductMap } from './types';

// 원천: CO-PA (GL 대사 검증된 실제원가 VV_COGS_A, 총매출 VV101). 당월·전월·3개월 원가를 같은 원천으로 맞춘다.
// 표준원가 필드(VV_COGS_S, VV2xx)는 2026-04 이후 부풀려져 있어 쓰지 않는다.
// 쿼리 로직을 바꾸면 캐시 키 버전(v2)을 올린다.
const COPA = '`harimfood-361004.harim_sap_bi.CO_PA`';
const MARA = '`harimfood-361004.harim_sap_bi.SD_MARA`';
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

async function queryMaterials(p: Periods): Promise<MaterialFact[]> {
  const rows = await runQuery<Record<string, unknown>>(
    `
    WITH base AS (
      SELECT c.ARTNR, c.BUDAT, c.ABSMG_EA AS q, c.VV101 AS s, c.VV_COGS_A AS g
      FROM ${COPA} c
      WHERE ${COPA_FILTER} AND c.BUDAT BETWEEN @costStart AND @today
    ),
    agg AS (
      SELECT ARTNR,
        SUM(IF(BUDAT BETWEEN @curStart AND @today, s, 0)) AS cur_sales,
        SUM(IF(BUDAT BETWEEN @curStart AND @today, q, 0)) AS cur_qty,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, s, 0)) AS prev_sales,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, q, 0)) AS prev_qty,
        SUM(IF(BUDAT BETWEEN @prevStart AND @prevEnd, g, 0)) AS prev_cogs,
        SUM(IF(BUDAT BETWEEN @costStart AND @costEnd, q, 0)) AS cost_qty,
        SUM(IF(BUDAT BETWEEN @costStart AND @costEnd, s, 0)) AS cost_sales,
        SUM(IF(BUDAT BETWEEN @costStart AND @costEnd, g, 0)) AS cost_cogs
      FROM base
      GROUP BY ARTNR
    )
    SELECT a.ARTNR AS matnr, ${HIER_COLS},
      a.cur_sales, a.cur_qty, a.prev_sales, a.prev_qty, a.prev_cogs, a.cost_qty, a.cost_sales, a.cost_cogs
    FROM agg a
    LEFT JOIN ${MARA} t ON t.MATNR = a.ARTNR
    WHERE a.cur_sales != 0 OR a.cur_qty != 0 OR a.prev_sales != 0 OR a.prev_qty != 0 OR a.prev_cogs != 0
       OR a.cost_qty != 0 OR a.cost_sales != 0 OR a.cost_cogs != 0
    `,
    {
      today: p.today,
      curStart: p.curStart,
      prevStart: p.prevStart,
      prevEnd: p.prevEnd,
      costStart: p.costStart,
      costEnd: p.costEnd,
    },
  );
  return rows.map((r) => ({
    ...hier(r),
    curSales: num(r.cur_sales),
    curQty: num(r.cur_qty),
    prevSales: num(r.prev_sales),
    prevQty: num(r.prev_qty),
    prevCogs: num(r.prev_cogs),
    costQty: num(r.cost_qty),
    costSales: num(r.cost_sales),
    costCogs: num(r.cost_cogs),
  }));
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

const cachedMaterials = unstable_cache(async (today: string) => queryMaterials(getPeriods(today)), ['copa-materials-v2'], {
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

export async function getDaily(today?: string) {
  const p = getPeriods(today);
  return { periods: p, daily: await cachedDaily(p.today) };
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
  // 헤더에 없는 열은 -1 → 빈칸
  const [cMat, cName, c1, c2, c3, cEtc, cCat, cOwner] = ['MATNR', '제품명', 'CM1', 'CM2', 'CM3', '기타', '카테고리', '담당자'].map((n) => names.indexOf(n));
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

async function readManualInputs(): Promise<ManualInput[]> {
  const rows = await getStore().read(TABS.manualInput);
  return rows
    .map(({ values: v }) => ({
      ym: toStr(v[0]),
      l1: toStr(v[1]),
      l1t: toStr(v[2]),
      incentive: toNum(v[3]),
      general: toNum(v[4]),
      updatedAt: toStr(v[5]),
      updatedBy: toStr(v[6]),
    }))
    .filter((m) => m.ym && m.l1);
}

// 시트를 직접 고친 경우를 위해 5분 주기로도 갱신. 앱에서 저장하면 updateTag('manual')로 즉시 갱신.
export const getProductMap = unstable_cache(readProductMap, ['product-map-v2'], { revalidate: 300, tags: ['manual'] });
export const getManualInputs = unstable_cache(readManualInputs, ['manual-input-lv1-v1'], {
  revalidate: 300,
  tags: ['manual'],
});

// ── 대시보드 조립 ──────────────────────────────────────────────

export async function getFacts(today?: string) {
  const p = getPeriods(today);
  return { periods: p, facts: await cachedMaterials(p.today) };
}

export async function getDashboard(today?: string): Promise<DashboardData> {
  const p = getPeriods(today);
  const [facts, daily, maps, inputs] = await Promise.all([
    cachedMaterials(p.today),
    cachedDaily(p.today),
    getProductMap(),
    getManualInputs(),
  ]);

  const curDates = daily.filter((d) => d.date >= p.curStart).map((d) => d.date);
  const dataDate = curDates.length ? curDates.reduce((a, b) => (a > b ? a : b)) : null;
  const progress = progressOf(dataDate, p.daysInMonth);

  const curInputs = inputs.filter((i) => i.ym === p.curYm);
  const prevInputs = inputs.filter((i) => i.ym === p.prevYm);
  const rows = buildRows({
    facts,
    maps,
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

  const l1Set = new Set(rows.filter((r) => r.mtd.sales || r.prev.sales).map((r) => r.l1));
  const filled = (list: ManualInput[]) => list.filter((i) => i.incentive || i.general).length;

  return {
    curYm: p.curYm,
    prevYm: p.prevYm,
    costYms: p.costYms,
    dataDate,
    progress,
    rows,
    coverage,
    inputStatus: { l1Total: l1Set.size, curFilled: filled(curInputs), prevFilled: filled(prevInputs) },
    storage: storageKind(),
  };
}

// ── 월별 (올해 1월 ~ 당월) ─────────────────────────────────────

const filledCount = (inputs: ManualInput[], ym: string) =>
  inputs.filter((i) => i.ym === ym && (i.incentive || i.general)).length;
const l1Count = (rows: { l1: string; amt: { sales: number } }[]) =>
  new Set(rows.filter((r) => r.amt.sales).map((r) => r.l1)).size;

/** 마감월은 CO-PA 실적 + 그 달 입력값, 당월은 대시보드의 월 예상. 9월처럼 대시보드 '전월'과 겹치는 달은 같은 원천이라 값이 같다. */
export async function getMonthBlocks(today?: string) {
  const p = getPeriods(today);
  const closed = ymRange(yearStartOf(p.curYm), p.prevYm);
  const [d, monthly, maps, inputs] = await Promise.all([
    getDashboard(today),
    closed.length ? cachedMonthly(p.today).then(expandMonthly) : Promise.resolve([] as MonthFact[]),
    getProductMap(),
    getManualInputs(),
  ]);

  const blocks: MonthBlock[] = closed.map((ym) => {
    const rows = buildMonthRows({ ym, facts: monthly, maps, inputs: inputs.filter((i) => i.ym === ym) });
    return { ym, kind: 'actual', rows, filled: filledCount(inputs, ym), l1Total: l1Count(rows) };
  });
  const curRows = toMonthRows(d.rows, 'fcst');
  blocks.push({ ym: p.curYm, kind: 'fcst', rows: curRows, filled: filledCount(inputs, p.curYm), l1Total: l1Count(curRows) });
  return { d, blocks, inputs, monthly };
}

export async function getTrend(axis: Axis, today?: string): Promise<TrendData> {
  const { d, blocks } = await getMonthBlocks(today);
  return {
    axis,
    months: blocks.map(({ ym, kind, filled, l1Total }) => ({ ym, kind, filled, l1Total })),
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
  for (const r of d.rows) {
    if (r.name === ORPHAN_NAME) continue;
    labels.set(r.l1, r.l1t);
    const it = item(r.matnr, r.l1);
    it.sales[cur] = r.mtd.sales;
    it.qty[cur] = r.mtd.qty;
  }
  return buildPriceTrend(months, [...items.values()], labels);
}

// ── 세그먼트(ABCD 매트릭스) ───────────────────────────────────

export interface SegmentData {
  products: SegProduct[];
  periods: { id: SegPeriod; label: string; costNote: string | null; compareOnly?: boolean }[];
  dataDate: string | null;
}

/** 제품별 기간 금액: 올해 누계(마감월 실적 + 당월 예상), 당월 예상, 전월 실적, 전전월 실적(비교 기준) */
export async function getSegment(today?: string): Promise<SegmentData> {
  const { d, blocks } = await getMonthBlocks(today);
  const n = blocks.length;
  const prev2 = n >= 3 ? blocks[n - 3] : null;
  const map = new Map<string, SegProduct>();
  const zero = (): [number, number, number, number] => [0, 0, 0, 0];
  const at = (r: MonthRow) => {
    let p = map.get(r.matnr);
    if (!p) {
      const { matnr, name, l1, l1t, l2, l2t, l3, l3t, l4, l4t } = r;
      p = { matnr, name, l1, l1t, l2, l2t, l3, l3t, l4, l4t, a: SEG_PERIODS.map(zero) };
      map.set(r.matnr, p);
    }
    return p;
  };
  const add = (r: MonthRow, period: SegPeriod) => {
    if (r.name === ORPHAN_NAME) return;
    const v = at(r).a[SEG_PERIODS.indexOf(period)];
    v[0] += r.amt.sales;
    v[1] += r.amt.qty;
    v[2] += r.amt.cogs;
    v[3] += r.amt.incentive + r.amt.general;
  };
  for (const b of blocks) for (const r of b.rows) add(r, 'ytd');
  for (const r of toMonthRows(d.rows, 'fcst')) add(r, 'fcst');
  for (const r of toMonthRows(d.rows, 'prev')) add(r, 'prev');
  if (prev2) for (const r of prev2.rows) add(r, 'prev2');

  // 화면 전달량을 줄이려고 원 단위로 반올림 (예상치는 소수가 길다)
  const products = [...map.values()]
    .map((p) => ({ ...p, a: p.a.map((v) => v.map(Math.round) as [number, number, number, number]) }))
    .filter((p) => p.a.some((v) => v[0] || v[2]));

  const cur = blocks[n - 1];
  const prevBlock = n >= 2 ? blocks[n - 2] : null;
  const note = (b: MonthBlock | null) =>
    b && b.filled < b.l1Total ? `${monthLabel(b.ym)} 장려금·일반비 ${b.filled}/${b.l1Total}개 계층 입력` : null;
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
    dataDate: d.dataDate,
  };
}
