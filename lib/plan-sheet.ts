import 'server-only';
import { unstable_cache } from 'next/cache';
import type { sheets_v4 } from 'googleapis';
import { sheetsClient } from './sheets';
import { monthHeader, parsePlanGrid, PLAN_HEADER, PLAN_TAB, type PlanItem, type PlanLv3 } from './plan';

// 판매계획 시트 읽기·쓰기. 운영 시트(SHEET_ID)의 plan_lv3 탭에서 사용자가 직접 입력한다 (행 = LV3, 열 = 월).
// 순수 파싱은 lib/plan.ts parsePlanGrid. 앱은 LV3 행과 월 열을 깔고 참고 매출만 고친다 — 계획 금액 칸은 건드리지 않는다.

const spreadsheetId = () => process.env.SHEET_ID?.trim() || '';

type Cell = string | number;

interface TabMeta {
  sheetId: number;
  rowCount: number;
  columnCount: number;
}

/** 0부터 센 열 번호 → 시트 열 이름 (A, …, Z, AA, …) */
function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

async function readGrid(api: sheets_v4.Sheets, id: string): Promise<{ tab: TabMeta | null; values: Cell[][] }> {
  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId,gridProperties(rowCount,columnCount))' });
  const p = (meta.data.sheets ?? []).map((s) => s.properties).find((x) => x?.title === PLAN_TAB);
  if (!p) return { tab: null, values: [] };
  const tab = { sheetId: p.sheetId ?? 0, rowCount: p.gridProperties?.rowCount ?? 1000, columnCount: p.gridProperties?.columnCount ?? 26 };
  const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `${PLAN_TAB}!A1:${colName(Math.max(tab.columnCount, 26) - 1)}`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return { tab, values: (res.data.values ?? []) as Cell[][] };
}

export interface PlanSheet {
  plans: PlanLv3[];
  /** 탭 gid (탭이 아직 없으면 null) — 시트 링크가 그 탭으로 바로 열리게 */
  gid: number | null;
  /** 시트에 행이 있는 LV3 코드, 월 열 (YYYYMM) */
  l3s: string[];
  months: string[];
  error: string | null;
}

/**
 * 판매계획 시트 전체. 시트를 직접 고치므로 5분 주기, 앱에서 행을 만들면 updateTag('manual')로 즉시.
 * 읽기에 실패해도 대시보드는 떠야 하므로 빈 계획 + error (입력 화면에 표시)
 */
export const getPlanSheet = unstable_cache(
  async (): Promise<PlanSheet> => {
    const id = spreadsheetId();
    if (!id) return { plans: [], gid: null, l3s: [], months: [], error: null };
    try {
      const { tab, values } = await readGrid(sheetsClient(), id);
      const g = parsePlanGrid(values);
      return { plans: g.plans, gid: tab?.sheetId ?? null, l3s: g.rows.map((r) => r.l3), months: g.months.map((m) => m.ym), error: null };
    } catch (e) {
      console.error('plan sheet', e);
      return { plans: [], gid: null, l3s: [], months: [], error: (e as Error).message || '판매계획 시트를 읽지 못했습니다.' };
    }
  },
  ['plan-sheet-v1'],
  { revalidate: 300, tags: ['manual'] },
);

/** 판매계획 탭 링크. 탭이 있으면 그 탭으로 바로 연다 */
export function planSheetUrl(gid: number | null): string | null {
  const id = spreadsheetId();
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ''}`;
}

const HEAD_FORMAT = { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.9, blue: 0.97 }, horizontalAlignment: 'CENTER' as const };

/**
 * LV3 행과 월 열을 깐다. 탭이 없으면 만들고, 없는 월 열은 오른쪽에 붙이고, 없는 LV3는 아래에 붙인다.
 * 이미 있는 LV3는 참고 매출(E열)만 고친다. 여러 번 실행해도 같은 결과이며 계획 금액 칸은 건드리지 않는다.
 */
export async function writePlanRows(months: string[], items: PlanItem[]): Promise<{ created: boolean; rows: number; cols: number }> {
  const id = spreadsheetId();
  if (!id) throw new Error('SHEET_ID 환경변수가 없습니다.');
  const api = sheetsClient();
  let { tab, values } = await readGrid(api, id);
  const created = !tab;
  const fixed = PLAN_HEADER.length;

  if (!tab) {
    const res = await api.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: PLAN_TAB, gridProperties: { rowCount: Math.max(items.length + 100, 1000), columnCount: fixed + months.length + 6, frozenRowCount: 1, frozenColumnCount: 4 } },
            },
          },
        ],
      },
    });
    const p = res.data.replies?.[0]?.addSheet?.properties;
    tab = { sheetId: p?.sheetId ?? 0, rowCount: p?.gridProperties?.rowCount ?? 1000, columnCount: p?.gridProperties?.columnCount ?? 26 };
    values = [];
  }

  // 1) 머리글: 고정 열 + 기존 월 열 + 없는 월 열
  const grid = parsePlanGrid(values);
  const head: Cell[] = values[0]?.length ? [...values[0]] : [...PLAN_HEADER];
  const have = new Set(grid.months.map((m) => m.ym));
  const newCols = months.filter((ym) => !have.has(ym));
  head.push(...newCols.map(monthHeader));

  // 2) 행: 있는 LV3는 참고 매출만, 없는 LV3는 아래에 붙인다
  const rowOf = new Map(grid.rows.map((r) => [r.l3, r.row]));
  const data: sheets_v4.Schema$ValueRange[] = [{ range: `${PLAN_TAB}!A1`, values: [head] }];
  const fresh: Cell[][] = [];
  for (const it of items) {
    const row = rowOf.get(it.l3);
    if (row) data.push({ range: `${PLAN_TAB}!E${row}`, values: [[Math.round(it.ref)]] });
    else fresh.push([it.l1t, it.l2t, it.l3, it.l3t, Math.round(it.ref)]);
  }
  const lastRow = Math.max(values.length, 1);
  if (fresh.length) data.push({ range: `${PLAN_TAB}!A${lastRow + 1}`, values: fresh });

  // 3) 격자 늘리기 + 서식 (머리글, 금액 열 숫자 서식, 새 탭이면 키 열 수정 경고)
  const needRows = lastRow + fresh.length;
  const requests: sheets_v4.Schema$Request[] = [];
  if (needRows > tab.rowCount) requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'ROWS', length: needRows - tab.rowCount + 200 } });
  if (head.length > tab.columnCount) requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: head.length - tab.columnCount + 6 } });
  requests.push(
    {
      repeatCell: {
        range: { sheetId: tab.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: head.length },
        cell: { userEnteredFormat: HEAD_FORMAT },
        fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: tab.sheetId, startRowIndex: 1, startColumnIndex: fixed - 1, endColumnIndex: head.length },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  );
  if (created) {
    requests.push(
      {
        // 참고 매출 열은 회색 (입력 칸과 구분)
        repeatCell: {
          range: { sheetId: tab.sheetId, startRowIndex: 1, startColumnIndex: fixed - 1, endColumnIndex: fixed },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 }, textFormat: { foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)',
        },
      },
      { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 5 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
      {
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: tab.sheetId, startColumnIndex: 0, endColumnIndex: fixed },
            description: 'LV1·LV2·LV3·참고 매출은 앱이 채우는 열입니다. 월 열(F~)에 계획 금액만 입력하세요.',
            warningOnly: true,
          },
        },
      },
    );
  }
  // 격자를 먼저 늘려야 값 쓰기가 범위를 넘지 않는다
  await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data } });
  return { created, rows: fresh.length, cols: newCols.length };
}
