// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, closedIdx, GENERAL_ITEMS, groupOfItem, ledgerInputs, statementOf, type GlRow, type LedgerMonth } from '../lib/ledger.ts';

const gl = (ym: string, acct: string, acctName: string, amt: number, cc = '', ccName = ''): GlRow => ({ ym, acct, acctName, cc, ccName, amt });

const months: LedgerMonth[] = [
  { ym: '202608', kind: 'closed' },
  { ym: '202609', kind: 'closed' },
  { ym: '202610', kind: 'estimate' },
];

const rows: GlRow[] = [
  // 매출조정: 8월 20, 9월 10 (+ 7월 30은 추정 기준에만 들어간다)
  gl('202607', '41201030', '매출조정_판매장려금', 30),
  gl('202608', '41201030', '매출조정_판매장려금', 20),
  gl('202609', '41201030', '매출조정_판매장려금', 10),
  gl('202610', '41201030', '매출조정_판매장려금', 4), // 마감 전 반영분
  // 판관비: 운반비(물류) 팀 A, 업무추진비(이름 변경 계정, 기타 경비) 팀 B
  gl('202607', '61301420', '운반비_택배비', 3, 'A', '물류팀'),
  gl('202608', '61301420', '운반비_택배비', 6, 'A', '물류팀'),
  gl('202609', '61301420', '운반비_택배비', 9, 'A', '물류팀'),
  gl('202609', '61300310', '업무추진비_영업', 5, 'B', '영업팀'),
  gl('202610', '61301420', '운반비_택배비', 1, 'A', '물류팀'),
  gl('202609', '51000000', '제조경비', 999), // 손익계산서 밖 계정은 무시
];

const ledger = () =>
  buildLedger({ months, sales: [1000, 900, 1100], cogs: [700, 650, 800], gl: rows, basisYms: ['202607', '202608', '202609'] });

test('원장: 마감월은 실적, 진행 중인 달은 추정 기준 3개월 평균, 반영분은 따로', () => {
  const l = ledger();
  assert.deepEqual(l.adj[0].values, [20, 10, 20]); // (30 + 20 + 10) / 3
  assert.equal(l.adj[0].label, '판매장려금');
  const logistics = l.sga.find((g) => g.key === 'logistics')!;
  assert.deepEqual(logistics.values, [6, 9, 6]); // (3 + 6 + 9) / 3
  const other = l.sga.find((g) => g.key === 'other')!;
  assert.deepEqual(other.items.map((i) => i.label), ['업무추진비']);
  assert.deepEqual(other.values, [0, 5, 2]); // 5 / 3 반올림
  assert.deepEqual(l.posted, { adj: 4, sga: 1 });
  assert.deepEqual(l.teams.map((t) => t.label), ['물류팀', '영업팀']);
});

test('손익: 순매출 = 총매출 − 매출조정, GP = 순매출 − 원가, OP = GP − 판관비, 이익률은 순매출 대비', () => {
  const l = ledger();
  const s = statementOf(l, [1]);
  assert.equal(s.net, 890);
  assert.equal(s.gp, 240);
  assert.equal(s.sga, 14);
  assert.equal(s.op, 226);
  assert.equal(s.opm, 226 / 890);
  assert.deepEqual(closedIdx(l), [0, 1]);
  assert.equal(statementOf(l, closedIdx(l)).sales, 1900);
});

test('판관비 분류: 계정 앞 6자리, 목록 밖은 기타 경비', () => {
  assert.equal(groupOfItem('612010').key, 'people');
  assert.equal(groupOfItem('613024').key, 'marketing');
  assert.equal(groupOfItem('613003').key, 'other');
});

test('원장 장려금·일반비를 채널 총매출 비중으로 나눈다 (매출 0 이하 채널·원장 없는 달은 제외)', () => {
  const sales = new Map([
    ['202609', [
      { ch: 'A', cht: '할인점', sales: 300 },
      { ch: 'A', cht: '할인점', sales: 100 },
      { ch: 'B', cht: '온라인', sales: 100 },
      { ch: 'C', cht: '반품', sales: -50 },
    ]],
    ['202608', [{ ch: 'A', cht: '할인점', sales: 100 }]],
  ]);
  const out = ledgerInputs([{ ym: '202609', adj: 50, general: 20 }], sales);
  assert.equal(out.length, 2);
  const a = out.find((i) => i.ch === 'A')!;
  assert.equal(a.incentive, 40);
  assert.equal(a.general, 16);
  assert.equal(a.rate, 0);
  assert.equal(out.reduce((s, i) => s + i.incentive, 0), 50);
  assert.ok(out.every((i) => i.ym === '202609'));
});

test('일반비 항목은 물류·광고판촉·수수료 분류만 (인건비·외주용역 제외)', () => {
  assert.ok(GENERAL_ITEMS.includes('613014'));
  assert.ok(GENERAL_ITEMS.includes('613024'));
  assert.ok(!GENERAL_ITEMS.includes('612010'));
  assert.ok(!GENERAL_ITEMS.includes('613021'));
});
