// 판관비 대시보드 내보내기(JSON) → 구글 시트 sga_link 탭. 저장소가 공개라 금액은 시트에만 둔다.
// 실행: node --conditions=react-server --env-file=.env.local scripts/import-sga-link.mts [JSON 경로]
//   JSON 기본 경로 data/sga-link.json (sga-calc scripts/export-daily-marketing.mts 출력, .gitignore 대상)
// (YYYYMM, 고객그룹3)로 덮어쓰고, 다시 내보낸 달에서 빠진 채널 행은 0으로 바꾼다. 다른 탭은 건드리지 않는다.
// SHEET_ID가 없으면 .data/sga_link.json(로컬 개발 저장소)에 쓴다.
import { readFileSync } from 'node:fs';
import { getStore, TABS, type Cell, type SheetRow } from '../lib/sheets.ts';
import { linkToRows, type SgaLink } from '../lib/sga-link.ts';

const file = process.argv[2] || 'data/sga-link.json';
try {
  const link = JSON.parse(readFileSync(file, 'utf8')) as SgaLink;
  const rows = linkToRows(link);
  const months = new Set(link.months.map((m) => m.ym));
  const store = getStore();
  const existing = await store.read(TABS.sgaLink);
  const key = (v: Cell[]) => `${String(v[0] ?? '').trim()}|${String(v[1] ?? '').trim()}`;
  const fresh = new Map(rows.map((r) => [key(r), r as Cell[]]));
  const updates: SheetRow[] = [];
  for (const r of existing) {
    const k = key(r.values);
    const hit = fresh.get(k);
    if (hit) {
      updates.push({ rowNumber: r.rowNumber, values: hit });
      fresh.delete(k);
    } else if (months.has(String(r.values[0] ?? '').trim())) {
      // 이번 내보내기에서 빠진 채널 → 0
      updates.push({ rowNumber: r.rowNumber, values: [r.values[0], r.values[1], 0, 0, 0, r.values[5] ?? '', link.generatedAt] });
    }
  }
  await store.update(TABS.sgaLink, updates);
  await store.append(TABS.sgaLink, [...fresh.values()]);
  console.log(`${store.kind === 'sheets' ? '구글 시트' : '로컬 .data'} ${TABS.sgaLink.name}: ${months.size}개월 · 갱신 ${updates.length}행 · 추가 ${fresh.size}행 (${link.generatedAt} 내보내기)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : '가져오기 실패');
  process.exit(1);
}
