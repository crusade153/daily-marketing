import ExcelJS from 'exceljs';
import type { NextRequest } from 'next/server';
import { getMonthBlocks } from '@/lib/data';
import { selectMonth } from '@/lib/month';
import { metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { Amounts, RowDims } from '@/lib/types';

export const dynamic = 'force-dynamic';

const NUM = '#,##0';
const COST_METHOD = { unit: '3개월 단위원가', rate: '계층 원가율 대체', none: '원가 없음' } as const;

const DIM_COLS: { header: string; get: (r: RowDims) => string; width: number }[] = [
  { header: '제품코드', get: (r) => r.matnr, width: 14 },
  { header: '제품명', get: (r) => r.name, width: 32 },
  { header: 'LV1코드', get: (r) => r.l1, width: 8 },
  { header: '제품계층 LV1', get: (r) => r.l1t, width: 14 },
  { header: 'LV2코드', get: (r) => r.l2, width: 11 },
  { header: '제품계층 LV2', get: (r) => r.l2t, width: 20 },
  { header: 'LV3코드', get: (r) => r.l3, width: 15 },
  { header: '제품계층 LV3', get: (r) => r.l3t, width: 20 },
  { header: 'LV4코드', get: (r) => r.l4, width: 20 },
  { header: '제품계층 LV4', get: (r) => r.l4t, width: 16 },
  { header: 'CM', get: (r) => r.cm, width: 12 },
  { header: '제품라인', get: (r) => r.category, width: 14 },
  { header: 'PM', get: (r) => r.owner, width: 10 },
  { header: '고객그룹3코드', get: (r) => r.ch, width: 8 },
  { header: '채널(고객그룹3)', get: (r) => r.cht, width: 14 },
  { header: '영업담당자', get: (r) => r.rep, width: 10 },
];

const AMT_COLS: { header: string; get: (a: Amounts) => number | null }[] = [
  { header: '수량(EA)', get: (a) => a.qty },
  { header: '총매출', get: (a) => a.sales },
  { header: '장려금', get: (a) => a.incentive },
  { header: '순매출', get: (a) => metrics(a).net },
  { header: '매출원가', get: (a) => a.cogs },
  { header: '매출총이익', get: (a) => metrics(a).gp },
  { header: '일반비', get: (a) => a.general },
  { header: '영업이익', get: (a) => metrics(a).op },
];

const round = (v: number | null) => (v == null ? null : Math.round(v));

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F6' } };
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/** 손익 RAW: 제품 × 채널 단위 원천. 시트 1 당월·전월, 시트 2 올해 월별(긴 형식), 시트 3 기준 */
export async function GET(request: NextRequest) {
  const { d, blocks } = await getMonthBlocks(selectMonth(request.nextUrl.searchParams.get('ym')).today);
  const cur = monthLabel(d.curYm);
  const prv = monthLabel(d.prevYm);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'daily-market';
  wb.created = new Date();

  // 1. 당월·전월 (제품별)
  const scen = [
    { key: 'mtd', label: `${cur} 누계` },
    { key: 'fcst', label: `${cur} 예상` },
    { key: 'prev', label: `${prv} 실적` },
  ] as const;
  const ws1 = wb.addWorksheet('당월·전월 제품×채널');
  ws1.columns = [
    ...DIM_COLS.map((c) => ({ header: c.header, width: c.width })),
    { header: '원가 산출', width: 16 },
    ...scen.flatMap((s) => AMT_COLS.map((c) => ({ header: `${s.label} ${c.header}`, width: 14, style: { numFmt: NUM } }))),
  ];
  for (const r of d.rows) {
    ws1.addRow([
      ...DIM_COLS.map((c) => c.get(r)),
      COST_METHOD[r.costMethod],
      ...scen.flatMap((s) => AMT_COLS.map((c) => round(c.get(r[s.key])))),
    ]);
  }
  styleHeader(ws1);

  // 2. 월별 (제품 × 월, 긴 형식 — 피벗용)
  const ws2 = wb.addWorksheet('월별 제품×채널');
  ws2.columns = [
    { header: '월', width: 9 },
    { header: '구분', width: 8 },
    ...DIM_COLS.map((c) => ({ header: c.header, width: c.width })),
    ...AMT_COLS.map((c) => ({ header: c.header, width: 14, style: { numFmt: NUM } })),
  ];
  for (const b of blocks) {
    for (const r of b.rows) {
      ws2.addRow([b.ym, b.kind === 'fcst' ? '예상' : '실적', ...DIM_COLS.map((c) => c.get(r)), ...AMT_COLS.map((c) => round(c.get(r.amt)))]);
    }
  }
  styleHeader(ws2);

  // 3. 기준
  const ws3 = wb.addWorksheet('기준');
  ws3.columns = [{ width: 22 }, { width: 100 }];
  const notes: [string, string][] = [
    ['데이터 기준일', d.dataDate ? `${d.dataDate.slice(0, 4)}-${d.dataDate.slice(4, 6)}-${d.dataDate.slice(6, 8)}` : '당월 실적 없음'],
    ['진행률', `${d.progress.elapsed}일 ÷ ${d.progress.daysInMonth}일`],
    ['원천', 'CO-PA (harim_sap_bi.CO_PA) 총매출 VV101, 실제원가 VV_COGS_A, 판매수량 ABSMG_EA. VRGAR=F, PLIKZ=0, BUKRS=1000'],
    ['금액 단위', '원 (수량은 EA)'],
    [`${cur} 매출원가`, `판매수량 × ${d.costYms.map(monthLabel).join('·')} 평균 단위원가. 이력이 없으면 LV2 → LV1 → 전사 원가율 × 매출`],
    [`${cur} 예상`, `누계 ÷ 진행일 × 월 일수`],
    ['마감월', 'CO-PA 실적 매출·실제원가'],
    ['행 단위', '제품 × 고객그룹3(채널). 채널은 CO-PA 고객(KNDNR·VKORG·VTWEG) → SD_KNVV.KVGR3'],
    ['손익 구조', '순매출 = 총매출 − 장려금, 매출총이익 = 순매출 − 매출원가, 영업이익 = 매출총이익 − 일반비. 이익률은 순매출 대비'],
    ['장려금·일반비', '장려금·일반비 고정비 = 고객그룹3별 월 입력 금액을 그 채널 안의 제품 총매출(양수) 비중으로 배부(누계 = 입력값 × 진행률). 일반비 변동비 = 각 행 총매출 × 채널 변동비율(%). 일반비 = 고정비 + 변동비'],
    ['(매출 없음 · 입력 비용)', '그 달 매출이 없는 채널에 입력된 비용을 담은 행'],
  ];
  notes.forEach((n) => ws3.addRow(n));
  ws3.getColumn(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const name = `손익_RAW_${d.dataDate ?? d.curYm}.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="daily-market-raw.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
