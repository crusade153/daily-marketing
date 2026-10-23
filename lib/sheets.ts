import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { google, type sheets_v4 } from 'googleapis';

// 구글 시트를 표 저장소로 쓴다. SHEET_ID가 없으면(로컬 개발) .data/<탭>.json 파일로 대신한다.
// 두 구현 모두 "헤더 1행 + 데이터 행" 2차원 배열을 다루고, 행 번호는 시트 기준(1부터, 헤더=1)이다.

export type Cell = string | number;
export interface SheetRow {
  rowNumber: number;
  values: Cell[];
}

export const TABS = {
  productMap: { name: 'product_map', header: ['MATNR', '제품명', 'CM1', 'CM2', 'CM3', '카테고리', '담당자'] },
  manualInput: {
    name: 'manual_input_lv1', // 2026-10-13 입력 단위를 PRDHA2 → LV1로 바꾸며 새 탭 (예전 manual_input 탭은 비어 있음)
    header: ['YYYYMM', '제품계층LV1', '제품계층LV1명', '장려금', '일반비', '수정일시', '수정자'],
  },
} as const;

type Tab = (typeof TABS)[keyof typeof TABS];

interface Store {
  kind: 'sheets' | 'local';
  read(tab: Tab): Promise<SheetRow[]>;
  update(tab: Tab, rows: SheetRow[]): Promise<void>;
  append(tab: Tab, rows: Cell[][]): Promise<void>;
}

const colLetter = (n: number) => String.fromCharCode(64 + n); // 헤더가 7열 이하라 A~Z면 충분

function sheetsStore(spreadsheetId: string): Store {
  const email = process.env.SHEETS_CLIENT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.SHEETS_PRIVATE_KEY ?? process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('시트 서비스계정 자격증명이 없습니다.');
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const api: sheets_v4.Sheets = google.sheets({ version: 'v4', auth });
  // 같은 탭을 동시에 읽어도 생성 요청은 한 번만 나가도록 진행 중인 Promise를 공유한다
  const ensured = new Map<string, Promise<void>>();

  async function createIfMissing(tab: Tab) {
    const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    if (meta.data.sheets?.some((s) => s.properties?.title === tab.name)) return;
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
      });
    } catch (e) {
      // 다른 인스턴스가 먼저 만든 경우
      if (String((e as Error).message).includes('already exists')) return;
      throw e;
    }
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab.name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...tab.header]] },
    });
  }

  function ensure(tab: Tab): Promise<void> {
    let p = ensured.get(tab.name);
    if (!p) {
      p = createIfMissing(tab).catch((e) => {
        ensured.delete(tab.name);
        throw e;
      });
      ensured.set(tab.name, p);
    }
    return p;
  }

  return {
    kind: 'sheets',
    async read(tab) {
      await ensure(tab);
      const res = await api.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab.name}!A2:${colLetter(tab.header.length)}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      return (res.data.values ?? []).map((values, i) => ({ rowNumber: i + 2, values: values as Cell[] }));
    },
    async update(tab, rows) {
      if (!rows.length) return;
      await ensure(tab);
      const last = colLetter(tab.header.length);
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: rows.map((r) => ({ range: `${tab.name}!A${r.rowNumber}:${last}${r.rowNumber}`, values: [r.values] })),
        },
      });
    },
    async append(tab, rows) {
      if (!rows.length) return;
      await ensure(tab);
      await api.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab.name}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
    },
  };
}

function localStore(): Store {
  const dir = path.join(process.cwd(), '.data');
  const file = (tab: Tab) => path.join(dir, `${tab.name}.json`);
  async function load(tab: Tab): Promise<Cell[][]> {
    try {
      return JSON.parse(await fs.readFile(file(tab), 'utf8'));
    } catch {
      return [[...tab.header]];
    }
  }
  async function save(tab: Tab, all: Cell[][]) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file(tab), JSON.stringify(all, null, 1), 'utf8');
  }
  return {
    kind: 'local',
    async read(tab) {
      const all = await load(tab);
      return all.slice(1).map((values, i) => ({ rowNumber: i + 2, values }));
    },
    async update(tab, rows) {
      const all = await load(tab);
      for (const r of rows) all[r.rowNumber - 1] = r.values;
      await save(tab, all);
    },
    async append(tab, rows) {
      const all = await load(tab);
      await save(tab, [...all, ...rows]);
    },
  };
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const id = process.env.SHEET_ID;
  if (id) return (store = sheetsStore(id));
  if (process.env.VERCEL) throw new Error('SHEET_ID 환경변수가 없습니다.');
  return (store = localStore());
}

export const storageKind = (): 'sheets' | 'local' => (process.env.SHEET_ID ? 'sheets' : 'local');
