// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlineFactor, momentum, momentumKind, opBridge, whaleCurve } from '../lib/insight.ts';
import { buildMonthRows, metrics, ZERO } from '../lib/pnl.ts';
import type { ChannelFact, ChannelInput, MonthRow } from '../lib/types.ts';

const cf = (matnr: string, ch: string, sales: number, qty = 0, cogs = 0): ChannelFact => ({ matnr, ch, cht: `채널${ch}`, sales, qty, cogs });
const ci = (ch: string, incentive: number, general: number): ChannelInput => ({
  ym: '202609',
  ch,
  cht: `채널${ch}`,
  incentive,
  general,
  rate: 0,
  updatedAt: '',
  updatedBy: '',
});
const month = (facts: ChannelFact[], inputs: ChannelInput[] = []): MonthRow[] =>
  buildMonthRows({ facts, dims: new Map(), maps: [], reps: new Map(), inputs });
const op = (rows: MonthRow[]) => metrics(rows.reduce((t, r) => ({ ...t, sales: t.sales + r.amt.sales, cogs: t.cogs + r.amt.cogs, incentive: t.incentive + r.amt.incentive, general: t.general + r.amt.general }), { ...ZERO })).op;

test('영업이익 브리지: 요인 합 = OP 차이, 가격·원가·물량·믹스 분리', () => {
  // a: 단가 10→12, 단위원가 6→7, 수량 100→100 / b: 단가 20, 원가 10, 수량 50→100 (물량·믹스)
  // c: 중단, d: 신규, e: 수량 0 (비교불가). 채널 E 장려금 100→300, 일반비 50→20, 매출 없는 채널 Q 비용 10
  const base = month([cf('a', 'E', 1000, 100, 600), cf('b', 'E', 1000, 50, 500), cf('c', 'E', 300, 10, 100), cf('e', 'E', 50, 0, 10)], [ci('E', 100, 50)]);
  const cur = month([cf('a', 'E', 1200, 100, 700), cf('b', 'E', 2000, 100, 1000), cf('d', 'E', 500, 5, 200), cf('e', 'E', 80, 0, 20)], [ci('E', 300, 20), ci('Q', 0, 10)]);
  const br = opBridge(base, cur);
  assert.equal(br.base, op(base));
  assert.equal(br.cur, op(cur));
  const v = Object.fromEntries(br.steps.map((s) => [s.key, s.value]));
  assert.equal(br.steps.reduce((s, x) => s + x.value, 0), br.cur - br.base);
  assert.equal(v.price, 200); // (12 − 10) × 100
  assert.equal(v.cost, -100); // −(7 − 6) × 100
  // 동일제품 수량 150 → 200 (k = 1/3), 기준 단위이익 a 4·b 10 → Σ Q0·m0 = 400 + 500 = 900 → 물량 300
  assert.equal(v.volume, 300);
  assert.equal(v.mix, 500 - 300 - 0); // Σ(Q1 − Q0)·m0 = 0×4 + 50×10 = 500
  assert.equal(v.newgone, 300 - 200); // d +300, c −200
  assert.equal(v.other, 60 - 40);
  assert.equal(v.incentive, -200);
  assert.equal(v.general, 30 - 10);
  assert.ok(br.matchedShare != null && Math.abs(br.matchedShare - 3200 / 3780) < 1e-12);
});

test('고래곡선: 정점 = 흑자 제품 이익 합, 최종 = 전체, 적자 제품 수', () => {
  const rows = month([cf('a', 'E', 100, 1, 20), cf('b', 'E', 100, 1, 70), cf('c', 'E', 100, 1, 150), cf('d', 'E', 100, 1, 110)]);
  const w = whaleCurve(rows, 'gp');
  assert.equal(w.n, 4);
  assert.equal(w.peak, 80 + 30);
  assert.equal(w.total, 80 + 30 - 50 - 10);
  assert.equal(w.winners, 2);
  assert.equal(w.losers, 2);
  assert.deepEqual(w.points[0], [0, 0]);
  assert.deepEqual(w.points[w.points.length - 1], [1, w.total]);
  assert.deepEqual(w.worst.map((c) => c.value), [-50, -10]);
});

test('성장 품질: GP 변화 = 매출효과 + 마진효과, 구분', () => {
  const base = month([cf('a', 'E', 1000, 10, 600)]);
  const cur = month([cf('a', 'E', 1500, 15, 1050)]);
  const [p] = momentum(base, cur, 'ch');
  assert.equal(p.salesEffect + p.marginEffect, p.gp1 - p.gp0);
  assert.equal(momentumKind(p), 'hollow'); // 매출 ↑, GP율 40% → 30%
  assert.equal(momentumKind({ s0: 10, s1: 5, m0: 0.1, m1: 0.2 }), 'defend');
});

test('장려금 전 이익률: 한쪽 달에만 장려금을 입력해도 이익률이 흔들리지 않는다', () => {
  const base = month([cf('a', 'E', 1000, 10, 600)]);
  const cur = month([cf('a', 'E', 1000, 10, 600)], [ci('E', 200, 0)]);
  assert.equal(momentum(base, cur, 'ch')[0].m1, 200 / 800);
  const [pre] = momentum(base, cur, 'ch', true);
  assert.equal(pre.m0, pre.m1);
  // 입력이 덜 된 비교의 대표 요인은 장려금·일반비를 빼고 고른다
  const br = opBridge(base, cur);
  assert.equal(headlineFactor(br, true)?.key, 'incentive');
  assert.notEqual(headlineFactor(br, false)?.key, 'incentive');
});
