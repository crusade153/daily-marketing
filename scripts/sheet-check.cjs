// 시트 탭 이름·헤더·행 수만 출력: node --env-file=.env.local scripts/sheet-check.cjs
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS 점검 스크립트 */
const { google } = require('googleapis');

const key = (process.env.SHEETS_PRIVATE_KEY ?? process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n');
const email = process.env.SHEETS_CLIENT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL;
const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const api = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

(async () => {
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  for (const s of meta.data.sheets) {
    const t = s.properties.title;
    const v = await api.spreadsheets.values.get({ spreadsheetId, range: `${t}!A:G` });
    const rows = v.data.values ?? [];
    console.log(t, '| header:', JSON.stringify(rows[0] ?? []), '| data rows:', Math.max(rows.length - 1, 0));
    if (process.argv[2] === 'rows') console.log(rows.slice(1, 6));
  }
})().catch((e) => console.log('ERR', e.message));
