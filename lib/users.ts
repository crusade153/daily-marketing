import 'server-only';
import { scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { google, type sheets_v4 } from 'googleapis';
import { toRole, type Role } from './auth';

// 사용자 계정 저장소 = 권한관리 구글 시트(AUTH_SHEET_ID). 데이터 시트(SHEET_ID)와 따로 둔다.
// 1행 헤더 COMPANY_ID · NAME · LOGIN_ID · PW · ROLE · STATUS. 열은 헤더 이름으로 찾으므로 순서를 바꾸거나 열을 더해도 된다.
// 탭은 AUTH_SHEET_TAB, 없으면 첫 번째 탭.
// STATUS가 ACTIVE인 행만 로그인할 수 있다 (그 밖의 값·빈칸 = PENDING). ROLE은 USER·ADMIN 권한 구분이고 빈칸이면 USER.
// 자동승인(settings 탭 AUTO_APPROVE)이 켜져 있으면 가입과 동시에 ACTIVE, 꺼져 있으면 PENDING. 회원관리 화면(/admin/users)에서 켜고 끈다.
// PW는 관리자가 시트에서 볼 수 있도록 평문으로 저장한다 (사용자 요청 2026-10-31). 예전 scrypt 해시 값은 첫 로그인 때 평문으로 바뀐다.

const COLS = ['COMPANY_ID', 'NAME', 'LOGIN_ID', 'PW', 'ROLE', 'STATUS'] as const;
type Col = (typeof COLS)[number];

export const STATUSES = ['ACTIVE', 'PENDING'] as const;
export type Status = (typeof STATUSES)[number];
const toStatus = (v: unknown): Status => (String(v ?? '').trim().toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PENDING');

export interface UserRow {
  rowNumber: number;
  companyId: string;
  name: string;
  loginId: string;
  pw: string;
  role: Role;
  status: Status;
}

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const isHashed = (stored: string) => stored.startsWith('scrypt$');

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (!isHashed(stored)) {
    const a = Buffer.from(pw);
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sameId = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

let api: sheets_v4.Sheets | null = null;
let tabP: Promise<{ title: string; sheetId: number }> | null = null;

function sheetId(): string {
  const id = process.env.AUTH_SHEET_ID;
  if (!id) throw new Error('AUTH_SHEET_ID 환경변수가 없습니다.');
  return id;
}

function client(): sheets_v4.Sheets {
  if (api) return api;
  const email = process.env.SHEETS_CLIENT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.SHEETS_PRIVATE_KEY ?? process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('시트 서비스계정 자격증명이 없습니다.');
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return (api = google.sheets({ version: 'v4', auth }));
}

/** 사용자 탭 (AUTH_SHEET_TAB 또는 첫 탭). 행 삭제에 숫자 sheetId가 필요해 함께 둔다 */
function userTab(): Promise<{ title: string; sheetId: number }> {
  tabP ??= client()
    .spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties(title,sheetId)' })
    .then((meta) => {
      const tabs = (meta.data.sheets ?? []).map((t) => t.properties ?? {});
      const fixed = process.env.AUTH_SHEET_TAB;
      const t = fixed ? tabs.find((x) => x.title === fixed) : tabs[0];
      if (!t?.title) throw new Error(fixed ? `권한관리 시트에 ${fixed} 탭이 없습니다.` : '권한관리 시트에 탭이 없습니다.');
      return { title: t.title, sheetId: t.sheetId ?? 0 };
    })
    .catch((e) => {
      tabP = null;
      throw e;
    });
  return tabP;
}

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const colLetter = (i: number) => String.fromCharCode(65 + i); // 0 → A

interface Table {
  tab: string;
  tabId: number;
  col: Record<Col, number>; // 0부터
  users: UserRow[];
}

async function readTable(): Promise<Table> {
  const { title: tab, sheetId: tabId } = await userTab();
  const res = await client().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${quote(tab)}!A1:Z`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [header = [], ...rows] = res.data.values ?? [];
  const names = header.map((h) => String(h ?? '').trim().toUpperCase());
  const col = {} as Record<Col, number>;
  for (const c of COLS) {
    const i = names.indexOf(c);
    if (i < 0) throw new Error(`권한관리 시트 1행에 ${c} 열이 없습니다.`);
    col[c] = i;
  }
  const cell = (r: unknown[], c: Col) => String(r[col[c]] ?? '').trim();
  const users = rows
    .map((r, i) => ({
      rowNumber: i + 2,
      companyId: cell(r, 'COMPANY_ID'),
      name: cell(r, 'NAME'),
      loginId: cell(r, 'LOGIN_ID'),
      pw: cell(r, 'PW'),
      role: toRole(r[col.ROLE]) ?? 'USER',
      status: toStatus(r[col.STATUS]),
    }))
    .filter((u) => u.loginId);
  return { tab, tabId, col, users };
}

/** 회원관리 화면용 전체 목록 (시트 순서) */
export async function listUsers(): Promise<UserRow[]> {
  return (await readTable()).users;
}

/** 로그인·가입용: 매번 시트를 새로 읽는다 */
export async function findUser(loginId: string): Promise<UserRow | null> {
  const { users } = await readTable();
  return users.find((u) => sameId(u.loginId, loginId)) ?? null;
}

// proxy의 주기 대조용 캐시. 시트 읽기 한도(분당 60회)를 아끼려고 인스턴스당 1분에 한 번만 읽는다
let cache: { at: number; p: Promise<UserRow[]> } | null = null;
export async function findUserCached(loginId: string): Promise<UserRow | null> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const p = readTable().then((t) => t.users);
    cache = { at: Date.now(), p };
    p.catch(() => {
      if (cache?.p === p) cache = null;
    });
  }
  const users = await cache.p;
  return users.find((u) => sameId(u.loginId, loginId)) ?? null;
}

export async function setPassword(rowNumber: number, stored: string): Promise<void> {
  const { tab, col } = await readTable();
  await client().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${quote(tab)}!${colLetter(col.PW)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[stored]] },
  });
}

export interface NewUser {
  companyId: string;
  name: string;
  loginId: string;
  password: string;
  role: Role;
  status: Status;
}

/** 계정 추가. 같은 로그인 아이디가 있으면 false */
export async function addUser(u: NewUser): Promise<boolean> {
  const { tab, col, users } = await readTable();
  if (users.some((x) => sameId(x.loginId, u.loginId))) return false;
  const row: string[] = Array(Math.max(...Object.values(col)) + 1).fill('');
  row[col.COMPANY_ID] = u.companyId;
  row[col.NAME] = u.name;
  row[col.LOGIN_ID] = u.loginId;
  row[col.PW] = u.password;
  row[col.ROLE] = u.role;
  row[col.STATUS] = u.status;
  await client().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${quote(tab)}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  cache = null;
  return true;
}

export type UserPatch = Partial<{ companyId: string; name: string; loginId: string; password: string; role: Role; status: Status }>;

/**
 * 로그인 아이디로 행을 다시 찾아 고친다 (화면을 연 뒤 시트에서 행이 밀렸어도 엉뚱한 행을 고치지 않도록).
 * 반환: 'ok' | 'missing'(계정 없음) | 'duplicate'(바꾸려는 아이디가 이미 있음)
 */
export async function updateUser(loginId: string, patch: UserPatch): Promise<'ok' | 'missing' | 'duplicate'> {
  const { tab, col, users } = await readTable();
  const u = users.find((x) => sameId(x.loginId, loginId));
  if (!u) return 'missing';
  if (patch.loginId && !sameId(patch.loginId, u.loginId) && users.some((x) => sameId(x.loginId, patch.loginId!))) return 'duplicate';
  const cells: [Col, string][] = [];
  if (patch.companyId !== undefined) cells.push(['COMPANY_ID', patch.companyId]);
  if (patch.name !== undefined) cells.push(['NAME', patch.name]);
  if (patch.loginId !== undefined) cells.push(['LOGIN_ID', patch.loginId]);
  if (patch.role !== undefined) cells.push(['ROLE', patch.role]);
  if (patch.status !== undefined) cells.push(['STATUS', patch.status]);
  if (patch.password) cells.push(['PW', patch.password]);
  if (!cells.length) return 'ok';
  await client().spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      valueInputOption: 'RAW',
      data: cells.map(([c, v]) => ({ range: `${quote(tab)}!${colLetter(col[c])}${u.rowNumber}`, values: [[v]] })),
    },
  });
  cache = null;
  return 'ok';
}

/** 행째 삭제. 없으면 false */
export async function deleteUser(loginId: string): Promise<boolean> {
  const { tabId, users } = await readTable();
  const u = users.find((x) => sameId(x.loginId, loginId));
  if (!u) return false;
  await client().spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId: tabId, dimension: 'ROWS', startIndex: u.rowNumber - 1, endIndex: u.rowNumber } } }],
    },
  });
  cache = null;
  return true;
}

// 설정은 같은 시트의 settings 탭 (KEY · VALUE). 탭이나 값이 없으면 자동승인은 꺼진 것으로 본다 (안전한 쪽)
const SETTINGS_TAB = 'settings';
const AUTO_APPROVE = 'AUTO_APPROVE';

async function readSettings(): Promise<{ exists: boolean; rows: string[][] }> {
  try {
    const res = await client().spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${SETTINGS_TAB}!A1:B` });
    return { exists: true, rows: (res.data.values ?? []).map((r) => r.map((c) => String(c ?? '').trim())) };
  } catch (e) {
    if (String((e as Error).message).includes('Unable to parse range')) return { exists: false, rows: [] };
    throw e;
  }
}

export async function getAutoApprove(): Promise<boolean> {
  const { rows } = await readSettings();
  const v = rows.find((r) => r[0]?.toUpperCase() === AUTO_APPROVE)?.[1] ?? '';
  return ['TRUE', 'ON', 'Y', '1'].includes(v.toUpperCase());
}

export async function setAutoApprove(on: boolean): Promise<void> {
  const { exists, rows } = await readSettings();
  if (!exists) {
    await client().spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: SETTINGS_TAB } } }] },
    });
  }
  const i = rows.findIndex((r) => r[0]?.toUpperCase() === AUTO_APPROVE);
  const values = rows.length ? [] : [['KEY', 'VALUE']];
  values.push([AUTO_APPROVE, on ? 'TRUE' : 'FALSE']);
  await client().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: i >= 0 ? `${SETTINGS_TAB}!A${i + 1}` : `${SETTINGS_TAB}!A${rows.length ? rows.length + 1 : 1}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}
