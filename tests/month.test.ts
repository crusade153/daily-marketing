// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthHref, monthLinks, selectMonth } from '../lib/month.ts';

test('기준월: 당월과 직전 1개월만, 그 밖은 당월로', () => {
  const cur = selectMonth(undefined, '20261101');
  assert.equal(cur.ym, '202611');
  assert.equal(cur.today, undefined);
  assert.equal(cur.prevYm, '202610');
  assert.equal(cur.nextYm, null);
  const oct = selectMonth('202610', '20261101');
  assert.equal(oct.today, '20261031');
  assert.equal(oct.prevYm, null);
  assert.equal(oct.nextYm, '202611');
  assert.equal(selectMonth('202609', '20261101').ym, '202611');
  assert.equal(selectMonth('202612', '20261101').ym, '202611');
  assert.equal(selectMonth('2026-10', '20261101').ym, '202611');
});

test('기준월 주소: 다른 쿼리는 지키고 당월이면 ym을 뺀다', () => {
  assert.equal(monthHref('/segment', '202610', '202611', { ch: 'A1' }), '/segment?ch=A1&ym=202610');
  assert.equal(monthHref('/segment', '202611', '202611', { ch: 'A1' }), '/segment?ch=A1');
  assert.equal(monthHref('/', '202611', '202611'), '/');
  const nav = monthLinks('/trend', selectMonth('202610', '20261101'), { axis: 'ch' });
  assert.deepEqual(nav, { ym: '202610', prevHref: null, nextHref: '/trend?axis=ch' });
});
