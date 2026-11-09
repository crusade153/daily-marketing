// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseMonths, channelRatios, lastClosedYm, linkActualInputs, linkForecastInputs, SGA_ACTUAL_AUTHOR, type SgaLink, type SgaLinkMonth } from '../lib/sga-link.ts';

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

test('마지막 마감월과 예측 기준 3개월', () => {
  assert.equal(lastClosedYm(link), '202609');
  assert.deepEqual(baseMonths(link, '202611').map((m) => m.ym), ['202607', '202608', '202609']);
  // 미마감 10월은 기준에서 빠진다
  assert.deepEqual(baseMonths(link, '202610').map((m) => m.ym), ['202607', '202608', '202609']);
  assert.deepEqual(baseMonths(link, '202606'), []);
});

test('채널 비율: 3개월 합계 기준, 매출 없던 채널은 전체 비율', () => {
  const { byCh, all } = channelRatios(baseMonths(link, '202611'));
  assert.equal(byCh.get('1')!.incentive, 600 / 4000);
  assert.equal(byCh.get('1')!.sga, 200 / 4000);
  assert.equal(byCh.get('7')!.incentive, 30 / 2000);
  assert.equal(all.incentive, 630 / 6000);
});

test('마감 실적 → 채널 입력: 대시보드 채널 코드(앞자리 0)로 되돌리고 판관비는 일반비 고정비', () => {
  const names = new Map([['1', { ch: '01', cht: '이마트' }]]);
  const out = linkActualInputs(link.months[3], names);
  assert.deepEqual(out[0], { ch: '01', cht: '이마트', ym: '202609', incentive: 400, general: 100, rate: 0, updatedAt: '', updatedBy: SGA_ACTUAL_AUTHOR });
  assert.equal(out[1].ch, '7');
});

test('예측: 장려금 = 비율 × 월 매출, 판관비 = 변동비율(%)', () => {
  const out = linkForecastInputs(link, '202611', [
    { ch: '01', cht: '이마트', sales: 10000 },
    { ch: '99', cht: '신규', sales: 6000 },
    { ch: '7', cht: '쿠팡', sales: 0 },
  ]);
  assert.equal(out.length, 2); // 매출 없는 채널은 넣지 않는다
  assert.equal(out[0].incentive, 10000 * (600 / 4000));
  assert.equal(out[0].rate, (200 / 4000) * 100);
  assert.equal(out[0].general, 0);
  // 기준 기간에 없던 채널 → 전체 비율
  assert.equal(out[1].incentive, 6000 * (630 / 6000));
});

test('마감 실적이 하나도 없으면 예측하지 않는다', () => {
  assert.deepEqual(linkForecastInputs({ ...link, months: [link.months[4]] }, '202611', [{ ch: '1', cht: 'a', sales: 100 }]), []);
});

test('시트 행 ↔ 연동 데이터 왕복', async () => {
  const { linkFromRows, linkToRows } = await import('../lib/sga-link.ts');
  const back = linkFromRows(linkToRows(link));
  assert.equal(back.generatedAt, link.generatedAt);
  assert.deepEqual(back.months.map((m) => [m.ym, m.closed, m.channels.length]), link.months.map((m) => [m.ym, m.closed, m.channels.length]));
  assert.equal(back.months[3].totals.incentive, 430);
});
