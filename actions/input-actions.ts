'use server';

import { updateTag } from 'next/cache';
import { z } from 'zod';
import { getStore, TABS, type Cell, type SheetRow } from '@/lib/sheets';

const Amount = z.number().finite().min(-1e13).max(1e13);

const SaveInput = z.object({
  ym: z.string().regex(/^\d{6}$/),
  user: z.string().trim().max(40),
  entries: z
    .array(z.object({ l1: z.string().min(1).max(40), l1t: z.string().max(80), incentive: Amount, general: Amount }))
    .max(500),
});

export type SaveResult = { ok: true; updated: number; appended: number } | { ok: false; error: string };

function nowKst(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}

/** 장려금·일반비 저장. (YYYYMM, 제품계층 LV1) 기준으로 기존 행은 덮어쓰고 없으면 추가한다. */
export async function saveManualInputs(input: unknown): Promise<SaveResult> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  const { ym, user, entries } = parsed.data;
  try {
    const store = getStore();
    const tab = TABS.manualInput;
    const existing = await store.read(tab);
    const rowByKey = new Map(existing.map((r) => [`${String(r.values[0]).trim()}|${String(r.values[1]).trim()}`, r]));
    const at = nowKst();
    const updates: SheetRow[] = [];
    const appends: Cell[][] = [];
    for (const e of entries) {
      const values: Cell[] = [ym, e.l1, e.l1t, Math.round(e.incentive), Math.round(e.general), at, user || '-'];
      const hit = rowByKey.get(`${ym}|${e.l1}`);
      if (hit) updates.push({ rowNumber: hit.rowNumber, values });
      else appends.push(values);
    }
    await store.update(tab, updates);
    await store.append(tab, appends);
    updateTag('manual');
    return { ok: true, updated: updates.length, appended: appends.length };
  } catch (e) {
    console.error('saveManualInputs', e);
    return { ok: false, error: `저장 실패: ${(e as Error).message}` };
  }
}

const AppendMap = z.array(z.object({ matnr: z.string().min(1).max(40), name: z.string().max(120) })).max(3000);

/** 미매핑 품목을 product_map 탭에 (MATNR, 제품명)만 채워 추가한다. CM·카테고리·담당자는 시트에서 직접 입력. */
export async function appendUnmappedProducts(input: unknown): Promise<SaveResult> {
  const parsed = AppendMap.safeParse(input);
  if (!parsed.success) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' };
  try {
    const store = getStore();
    const tab = TABS.productMap;
    const have = new Set((await store.read(tab)).map((r) => String(r.values[0] ?? '').trim()));
    const rows = parsed.data.filter((p) => !have.has(p.matnr)).map((p) => [p.matnr, p.name, '', '', '', '', '']);
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
  updateTag('bq');
  updateTag('manual');
}
