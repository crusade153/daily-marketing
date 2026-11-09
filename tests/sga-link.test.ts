// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastClosedYm, linkActualInputs, linkFromRows, linkToRows, SGA_ACTUAL_AUTHOR, type SgaLink, type SgaLinkMonth } from '../lib/sga-link.ts';

const month = (ym: string, closed: boolean, channels: [string, number, number, number][]): SgaLinkMonth => ({
  ym,
  closed,
  totals: { sales: 0, incentive: 0, sga: 0 },
  channels: channels.map(([ch, sales, incentive, sga]) => ({ ch, sales, incentive, sga })),
});

const link: SgaLink = {
  source: 'sga-calc',
  generatedAt: '2026-11-09T00:00:00Z',
  months: [
    month('202606', true, [['1', 1000, 100, 50]]),
    month('202607', true, [['1', 1000, 100, 50], ['7', 500, 0, 10]]),
    month('202608', true, [['1', 1000, 100, 50], ['7', 500, 0, 10]]),
    month('202609', true, [['1', 2000, 400, 100], ['7', 1000, 30, 20]]),
    month('202610', false, [['1', 300, 5, 20]]),
  ],
};

test('마지막 마감월', () => {
  assert.equal(lastClosedYm(link), '202609');
});

test('마감 실적 → 채널 입력: 대시보드 채널 코드(앞자리 0)로 되돌리고 판관비는 일반비 고정비', () => {
  const names = new Map([['1', { ch: '01', cht: '이마트' }]]);
  const out = linkActualInputs(link.months[3], names);
  assert.deepEqual(out[0], { ch: '01', cht: '이마트', ym: '202609', incentive: 400, general: 100, rate: 0, updatedAt: '', updatedBy: SGA_ACTUAL_AUTHOR });
  assert.equal(out[1].ch, '7');
});

test('시트 행 ↔ 연동 데이터 왕복', () => {
  const back = linkFromRows(linkToRows(link));
  assert.equal(back.generatedAt, link.generatedAt);
  assert.deepEqual(back.months.map((m) => [m.ym, m.closed, m.channels.length]), link.months.map((m) => [m.ym, m.closed, m.channels.length]));
  assert.equal(back.months[3].totals.incentive, 430);
});
