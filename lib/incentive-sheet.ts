import 'server-only';
import { unstable_cache } from 'next/cache';
import type { sheets_v4 } from 'googleapis';
import { sheetsClient } from './sheets';
import { INCENTIVE_HEADER, newSheetRows, parseIncentiveRows, recordKey, tabTitle, type IncentiveGroup, type IncentiveRecord } from './incentive';

// 장려금 입력 시트(별도 구글 시트, INCENTIVE_SHEET_ID) 읽기·쓰기. 순수 계산은 lib/incentive.ts
// 서비스계정(SHEETS_CLIENT_EMAIL)이 그 시트의 편집자여야 한다. 1행이 'YYYYMM'으로 시작하는 탭만 읽는다 (안내용 탭은 무시).

export const incentiveSheetId = () => process.env.INCENTIVE_SHEET_ID?.trim() || '';
export const incentiveSheetUrl = () => (incentiveSheetId() ? `https://docs.google.com/spreadsheets/d/${incentiveSheetId()}/edit` : null);

const LAST_COL = String.fromCharCode(64 + INCENTIVE_HEADER.length); // P
const quote = (title: string) => `'${title.replace(/'/g, "''")}'`;

interface TabInfo {
  title: string;
  sheetId: number;
  /** 데이터 행의 영업그룹 코드 (비어 있으면 '') */
  sg: string;
  isData: boolean;
  /** 헤더 포함 값이 있는 행 수 (다음 쓸 행 = rows + 1) */
  rows: number;
  /** 시트 격자 행 수 (넘으면 행을 늘린 뒤 쓴다) */
  gridRows: number;
}

async function readAll(): Promise<{ records: IncentiveRecord[]; tabs: TabInfo[] }> {
  const spreadsheetId = incentiveSheetId();
  if (!spreadsheetId) return { records: [], tabs: [] };
  const api = sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties.rowCount)' });
  const sheets = (meta.data.sheets ?? []).map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? 0, gridRows: s.properties?.gridProperties?.rowCount ?? 1000 }));
  if (!sheets.length) return { records: [], tabs: [] };
  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: sheets.map((s) => `${quote(s.title)}!A1:${LAST_COL}`),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const records: IncentiveRecord[] = [];
  const tabs: TabInfo[] = sheets.map((s, i) => {
    const values = (res.data.valueRanges?.[i]?.values ?? []) as (string | number)[][];
    const isData = String(values[0]?.[0] ?? '').trim() === INCENTIVE_HEADER[0];
    if (!isData) return { ...s, sg: '', isData, rows: values.length };
    const recs = parseIncentiveRows(values.slice(1), s.title);
    records.push(...recs);
    return { ...s, sg: recs[0]?.sg ?? '', isData, rows: values.length };
  });
  return { records, tabs };
}

/**
 * 시트 입력 기록 전체. 시트를 직접 고치므로 5분 주기, 앱에서 행을 만들면 updateTag('manual')로 즉시.
 * 읽기에 실패해도(공유 안 됨 등) 대시보드는 떠야 하므로 빈 목록 + error를 돌려준다 (입력 화면에 표시)
 */
export const getIncentiveSheet = unstable_cache(
  async (): Promise<{ records: IncentiveRecord[]; error: string | null }> => {
    try {
      return { records: (await readAll()).records, error: null };
    } catch (e) {
      console.error('incentive sheet', e);
      return { records: [], error: (e as Error).message || '장려금 시트를 읽지 못했습니다.' };
    }
  },
  ['incentive-sheet-v1'],
  { revalidate: 300, tags: ['manual'] },
);

/** 새 탭 서식: 머리글·숫자 서식·필터·고객그룹 띠·키 열(A~E) 수정 경고 */
function formatRequests(sheetId: number): sheets_v4.Schema$Request[] {
  const cols = INCENTIVE_HEADER.length;
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.9, blue: 0.97 }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: cols },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: cols - 1, endColumnIndex: cols },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 5 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: cols } } } },
    {
      // 월·고객그룹이 바뀔 때마다 띠 색을 번갈아 넣는다 (병합 셀 대신)
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=ISODD(SUMPRODUCT(--($A$2:$A2&$C$2:$C2<>$A$1:$A1&$C$1:$C1)))' }] },
            format: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } },
          },
        },
      },
    },
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startColumnIndex: 0, endColumnIndex: 5 },
          description: '월·영업그룹·고객그룹·카테고리는 앱이 만든 키입니다. 금액(F~O)만 입력하세요.',
          warningOnly: true,
        },
      },
    },
  ];
}

/**
 * 그 달 입력 행을 만든다. 영업그룹마다 탭이 없으면 만들고, 이미 있는 (월·영업그룹·고객그룹3·카테고리) 행은 건너뛴다.
 * 여러 번 실행해도 같은 결과 (새로 매출이 생긴 조합만 아래에 붙는다).
 * 시트 쓰기 한도(분당 60회)를 넘지 않게 탭 생성·서식·값 쓰기를 각각 한 번에 보낸다.
 */
export async function writeIncentiveRows(ym: string, groups: IncentiveGroup[]): Promise<{ tabs: number; rows: number }> {
  const spreadsheetId = incentiveSheetId();
  if (!spreadsheetId) throw new Error('INCENTIVE_SHEET_ID 환경변수가 없습니다.');
  const api = sheetsClient();
  const { records, tabs } = await readAll();
  const existing = new Set(records.map((r) => recordKey(r.ym, r.sg, r.ch, r.cat)));
  const titles = new Set(tabs.map((t) => t.title));

  // 1) 영업그룹 → 탭 (없으면 새로 만들 이름)
  const plan: { g: IncentiveGroup; tab: TabInfo | null; title: string }[] = [];
  for (const g of groups) {
    const own = tabs.find((t) => t.isData && t.sg === g.sg) ?? null;
    if (own) {
      plan.push({ g, tab: own, title: own.title });
      continue;
    }
    let title = tabTitle(g.sgt, g.sg);
    const same = tabs.find((t) => t.title === title);
    if (same?.isData && !same.sg) {
      plan.push({ g, tab: same, title }); // 머리글만 있는 빈 탭
      continue;
    }
    if (titles.has(title)) title = `${title} (${g.sg})`;
    titles.add(title);
    plan.push({ g, tab: null, title });
  }

  // 2) 새 탭 만들기 → 서식
  const fresh = plan.filter((p) => !p.tab && newSheetRows(ym, p.g, existing).length);
  if (fresh.length) {
    const res = await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: fresh.map((p) => ({ addSheet: { properties: { title: p.title, gridProperties: { frozenRowCount: 1, frozenColumnCount: 5 } } } })) },
    });
    fresh.forEach((p, i) => {
      const props = res.data.replies?.[i]?.addSheet?.properties;
      p.tab = { title: p.title, sheetId: props?.sheetId ?? 0, sg: p.g.sg, isData: true, rows: 0, gridRows: props?.gridProperties?.rowCount ?? 1000 };
    });
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fresh.flatMap((p) => formatRequests(p.tab!.sheetId)) } });
  }

  // 3) 머리글(새 탭) + 새 행을 한 번에 쓴다. 격자보다 길어지는 탭은 행을 먼저 늘린다
  const data: sheets_v4.Schema$ValueRange[] = [];
  const grow: sheets_v4.Schema$Request[] = [];
  let appended = 0;
  for (const p of plan) {
    const rows = newSheetRows(ym, p.g, existing);
    if (!rows.length || !p.tab) continue;
    if (p.tab.rows === 0) {
      data.push({ range: `${quote(p.title)}!A1`, values: [[...INCENTIVE_HEADER]] });
      p.tab.rows = 1;
    }
    data.push({ range: `${quote(p.title)}!A${p.tab.rows + 1}`, values: rows });
    p.tab.rows += rows.length;
    appended += rows.length;
    if (p.tab.rows > p.tab.gridRows) grow.push({ appendDimension: { sheetId: p.tab.sheetId, dimension: 'ROWS', length: p.tab.rows - p.tab.gridRows + 200 } });
  }
  if (grow.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: grow } });
  if (data.length) await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } });
  return { tabs: fresh.length, rows: appended };
}
