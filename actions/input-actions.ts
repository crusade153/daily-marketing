'use server';

import { updateTag } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getStore, TABS, type Cell, type SheetRow } from '@/lib/sheets';

const Amount = z.number().finite().min(-1e13).max(1e13);

export type SaveResult = { ok: true; updated: number; appended: number } | { ok: false; error: string };

function nowKst(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}

type AnyTab = (typeof TABS)[keyof typeof TABS];

/**
 * 키가 같은 행은 덮어쓰고 없으면 추가한다. key는 행 값에서 키 문자열을 만든다.
 * writeHeader: 헤더에 열이 늘어난 탭(예: 일반비 추가)은 1행 헤더도 다시 쓴다.
 */
async function upsert(tab: AnyTab, rows: Cell[][], key: (v: Cell[]) => string, writeHeader = false): Promise<SaveResult> {
  const store = getStore();
  const existing = await store.read(tab);
  const rowByKey = new Map(existing.map((r) => [key(r.values), r]));
  const updates: SheetRow[] = [];
  const appends: Cell[][] = [];
  for (const values of rows) {
    const hit = rowByKey.get(key(values));
    if (hit) updates.push({ rowNumber: hit.rowNumber, values });
    else appends.push(values);
  }
  if (writeHeader) updates.push({ rowNumber: 1, values: [...tab.header] });
  await store.update(tab, updates);
  await store.append(tab, appends);
  updateTag('manual');
  return { ok: true, updated: updates.length - (writeHeader ? 1 : 0), appended: appends.length };
}

// 서버 액션은 어느 경로(공개된 /login 포함)로도 호출될 수 있어 proxy만으로는 막히지 않는다. 액션마다 세션을 다시 확인한다
const NO_SESSION: SaveResult = { ok: false, error: '로그인이 필요합니다. 다시 로그인하세요.' };

const fail = (name: string, e: unknown): SaveResult => {
  console.error(name, e);
  return { ok: false, error: `저장 실패: ${(e as Error).message}` };
};
const cellKey = (...v: Cell[]) => v.map((x) => String(x ?? '').trim()).join('|');

const AmountSaveInput = z.object({
  ym: z.string().regex(/^\d{6}$/),
  user: z.string().trim().max(40),
  entries: z.array(z.object({ key: z.string().min(1).max(30), name: z.string().max(120), amount: Amount })).max(2000),
});

/** 장려금 저장: 영업그룹 × 월 (원). (YYYYMM, 영업그룹) 기준 upsert */
export async function saveSgIncentives(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = AmountSaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { ym, user, entries } = parsed.data;
  const at = nowKst();
  try {
    return await upsert(TABS.sgInput, entries.map((e) => [ym, e.key, e.name, Math.round(e.amount), at, user || '-']), (v) => cellKey(v[0], v[1]));
  } catch (e) {
    return fail('saveSgIncentives', e);
  }
}

/**
 * 일반비 저장: 고객그룹3 × 월 (원). 기존 탭 manual_input_channel의 '일반비 고정비' 열에 쓴다.
 * 장려금(영업그룹으로 옮김)·변동비율(폐지) 열은 0으로 비운다 — 2026-11-09 사용자 결정
 */
export async function saveChannelGenerals(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = AmountSaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { ym, user, entries } = parsed.data;
  const at = nowKst();
  try {
    return await upsert(
      TABS.channelInput,
      entries.map((e) => [ym, e.key, e.name, 0, at, user || '-', Math.round(e.amount), 0]),
      (v) => cellKey(v[0], v[1]),
      true,
    );
  } catch (e) {
    return fail('saveChannelGenerals', e);
  }
}

/** 판매계획 저장: 제품계층 LV3 × 월 매출 금액(원). (YYYYMM, LV3) 기준 upsert */
export async function savePlans(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = AmountSaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { ym, user, entries } = parsed.data;
  const at = nowKst();
  try {
    return await upsert(TABS.plan, entries.map((e) => [ym, e.key, e.name, Math.round(e.amount), at, user || '-']), (v) => cellKey(v[0], v[1]));
  } catch (e) {
    return fail('savePlans', e);
  }
}

const ChannelOwnerInput = z.object({
  user: z.string().trim().max(40),
  entries: z.array(z.object({ ch: z.string().min(1).max(20), cht: z.string().max(80), rep: z.string().trim().max(40) })).max(200),
});

/** 고객그룹3별 영업담당자 저장. 고객그룹3 기준 upsert (빈 이름 = 미지정) */
export async function saveChannelOwners(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = ChannelOwnerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { user, entries } = parsed.data;
  const at = nowKst();
  try {
    return await upsert(TABS.channelOwner, entries.map((e) => [e.ch, e.cht, e.rep, at, user || '-']), (v) => cellKey(v[0]));
  } catch (e) {
    return fail('saveChannelOwners', e);
  }
}

const TargetRowsInput = z.object({
  ym: z.string().regex(/^\d{6}$/),
  items: z.array(z.object({ matnr: z.string().min(1).max(40), name: z.string().max(120) })).max(5000),
});

/** 목표 시트에 그 달 제품 행(YYYYMM·MATNR·제품명)만 추가한다. 이미 있는 제품은 건너뛴다. 금액은 시트에서 입력 */
export async function appendTargetRows(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = TargetRowsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { ym, items } = parsed.data;
  try {
    const store = getStore();
    const tab = TABS.target;
    const have = new Set((await store.read(tab)).map((r) => cellKey(r.values[0], r.values[1])));
    const rows = items.filter((i) => !have.has(cellKey(ym, i.matnr))).map((i) => [ym, i.matnr, i.name, '', '', '']);
    await store.append(tab, rows);
    updateTag('manual');
    return { ok: true, updated: 0, appended: rows.length };
  } catch (e) {
    return fail('appendTargetRows', e);
  }
}

const LineOwnerInput = z.object({
  user: z.string().trim().max(40),
  entries: z
    .array(z.object({ line: z.string().trim().min(1).max(80), cm: z.string().trim().max(40), pm: z.string().trim().max(40) }))
    .max(500),
});

/** 제품라인별 CM·PM 이름 저장. 제품라인 기준으로 기존 행은 덮어쓰고 없으면 추가한다 (빈 이름 = 시트 기본값 사용). */
export async function saveLineOwners(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = LineOwnerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { user, entries } = parsed.data;
  try {
    const store = getStore();
    const tab = TABS.lineOwner;
    const existing = await store.read(tab);
    const rowByLine = new Map(existing.map((r) => [String(r.values[0] ?? '').trim(), r]));
    const at = nowKst();
    const updates: SheetRow[] = [];
    const appends: Cell[][] = [];
    for (const e of entries) {
      const values: Cell[] = [e.line, e.cm, e.pm, at, user || '-'];
      const hit = rowByLine.get(e.line);
      if (hit) updates.push({ rowNumber: hit.rowNumber, values });
      else appends.push(values);
    }
    await store.update(tab, updates);
    await store.append(tab, appends);
    updateTag('manual');
    return { ok: true, updated: updates.length, appended: appends.length };
  } catch (e) {
    console.error('saveLineOwners', e);
    return { ok: false, error: `저장 실패: ${(e as Error).message}` };
  }
}

const AppendMap = z.array(z.object({ matnr: z.string().min(1).max(40), name: z.string().max(120) })).max(3000);

/** 미매핑 품목을 product_map 탭에 (MATNR, 제품명)만 채워 추가한다. CM·카테고리·담당자는 시트에서 직접 입력. */
export async function appendUnmappedProducts(input: unknown): Promise<SaveResult> {
  if (!(await getSession())) return NO_SESSION;
  const parsed = AppendMap.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  try {
    const store = getStore();
    const tab = TABS.productMap;
    const have = new Set((await store.read(tab)).map((r) => String(r.values[0] ?? '').trim()));
    const rows = parsed.data.filter((p) => !have.has(p.matnr)).map((p) => [p.matnr, p.name, ...tab.header.slice(2).map(() => '')]);
    await store.append(tab, rows);
    updateTag('manual');
    return { ok: true, updated: 0, appended: rows.length };
  } catch (e) {
    console.error('appendUnmappedProducts', e);
    return { ok: false, error: `추가 실패: ${(e as Error).message}` };
  }
}

/** 캐시를 비우고 BigQuery·시트를 다시 읽는다 */
export async function refreshAll(): Promise<void> {
  if (!(await getSession())) throw new Error('로그인이 필요합니다.');
  updateTag('bq');
  updateTag('manual');
}
