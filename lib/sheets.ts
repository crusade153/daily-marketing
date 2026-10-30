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
  // 실제 시트는 1행에 안내 문구, 2행에 헤더가 있다. 읽을 때는 헤더 이름으로 열을 찾는다 (data.ts readProductMap)
  productMap: { name: 'product_map', header: ['MATNR', '제품명', 'CM1', 'CM2', 'CM3', '카테고리', '담당자', '기타'] },
  // 예전 LV1 입력 탭 manual_input_lv1은 2026-10-30부터 쓰지 않는다 (비용 입력을 고객그룹3으로 일원화, 시트 탭은 보관)
  // 제품라인(product_map 카테고리)별 CM·PM 이름. '[CM1]'처럼 대괄호 행은 CM 표시별 기본 이름. 첫 저장 때 탭 자동 생성
  lineOwner: { name: 'line_owner', header: ['제품라인', 'CM명', 'PM명', '수정일시', '수정자'] },
  // 장려금·일반비 고객그룹3(채널) × 월. 일반비 고정비(G)·변동비율%(H)는 2026-10-30에 뒤에 추가 — 기존 행 위치를 지키려고 끝에 둔다
  channelInput: {
    name: 'manual_input_channel',
    header: ['YYYYMM', '고객그룹3', '고객그룹3명', '장려금', '수정일시', '수정자', '일반비 고정비', '일반비 변동비율(%)'],
  },
  // 고객그룹3별 영업담당자 (채널당 한 명)
  channelOwner: { name: 'channel_owner', header: ['고객그룹3', '고객그룹3명', '영업담당자', '수정일시', '수정자'] },
  // 제품 × 월 목표 (원). 사용자가 시트에서 직접 입력, 대시보드는 제품 행만 채워 준다
  target: { name: 'target_product', header: ['YYYYMM', 'MATNR', '제품명', '매출목표', 'GP목표', 'OP목표'] },
} as const;

type Tab = (typeof TABS)[keyof typeof TABS];

interface Store {
  kind: 'sheets' | 'local';
  read(tab: Tab): Promise<SheetRow[]>;
  update(tab: Tab, rows: SheetRow[]): Promise<void>;
  append(tab: Tab, rows: Cell[][]): Promise<void>;
}

const colLetter = (n: number) => String.fromCharCode(64 + n); // 헤더가 8열 이하라 A~Z면 충분

function sheetsStore(spreadsheetId: string): Store {
  const email = process.env.SHEETS_CLIENT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.SHEETS_PRIVATE_KEY ?? process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('시트 서비스계정 자격증명이 없습니다.');
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const api: sheets_v4.Sheets = google.sheets({ version: 'v4', auth });
  // 시트 읽기 한도(분당 60회)를 넘지 않도록: 탭 목록은 프로세스당 한 번, 같은 탭을 동시에 읽으면 요청 하나를 공유한다
  const ensured = new Map<string, Promise<void>>();
  const inflight = new Map<string, Promise<SheetRow[]>>();
  let titlesP: Promise<Set<string>> | null = null;
  const titles = () => {
    titlesP ??= api.spreadsheets
      .get({ spreadsheetId, fields: 'sheets.properties.title' })
      .then((meta) => new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? '')))
      .catch((e) => {
        titlesP = null;
        throw e;
      });
    return titlesP;
  };

  /** 쓰기 전에만 탭을 만든다 (읽기는 탭이 없으면 빈 목록) */
  async function createIfMissing(tab: Tab) {
    const known = await titles();
    if (known.has(tab.name)) return;
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
      });
    } catch (e) {
      // 다른 인스턴스가 먼저 만든 경우
      if (String((e as Error).message).includes('already exists')) {
        known.add(tab.name);
        return;
      }
      throw e;
    }
    known.add(tab.name);
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
    read(tab) {
      let p = inflight.get(tab.name);
      if (!p) {
        p = (async () => {
          if (!(await titles()).has(tab.name)) return [];
          const res = await api.spreadsheets.values.get({
            spreadsheetId,
            range: `${tab.name}!A2:${colLetter(tab.header.length)}`,
            valueRenderOption: 'UNFORMATTED_VALUE',
          });
          return (res.data.values ?? []).map((values, i) => ({ rowNumber: i + 2, values: values as Cell[] }));
        })().finally(() => inflight.delete(tab.name));
        inflight.set(tab.name, p);
      }
      return p;
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
