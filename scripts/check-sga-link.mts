// 시트 sga_link 탭 월 합계 확인 (읽기만). 실행: node --conditions=react-server --env-file=.env.local scripts/check-sga-link.mts
import { getStore, TABS } from '../lib/sheets.ts';

const rows = await getStore().read(TABS.sgaLink);
const by = new Map<string, { inc: number; sga: number; n: number; at: string }>();
for (const { values: v } of rows) {
  const ym = String(v[0] ?? '');
  const m = by.get(ym) ?? { inc: 0, sga: 0, n: 0, at: '' };
  m.inc += Number(v[3]) || 0;
  m.sga += Number(v[4]) || 0;
  m.n++;
  if (String(v[6] ?? '') > m.at) m.at = String(v[6]);
  by.set(ym, m);
}
for (const [ym, m] of [...by].sort()) console.log(`${ym} 장려금 ${(m.inc / 1e8).toFixed(2)}억 · 판관비 ${(m.sga / 1e8).toFixed(2)}억 · ${m.n}행 · ${m.at}`);
