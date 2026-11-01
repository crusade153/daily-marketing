// node --test tests/  (Node 24 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isYm, monthHref, monthLinks, selectMonth } from '../lib/month.ts';

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

test('기준월 주소: 다른 쿼리는 지키고 당월도 ym을 적는다 (빼면 저장된 지난달 쿠키로 돌아간다)', () => {
  assert.equal(monthHref('/segment', '202610', { ch: 'A1' }), '/segment?ch=A1&ym=202610');
  assert.equal(monthHref('/segment', '202611', { ch: 'A1' }), '/segment?ch=A1&ym=202611');
  assert.equal(monthHref('/', null), '/');
  const nav = monthLinks('/trend', selectMonth('202610', '20261101'), { axis: 'ch' });
  assert.deepEqual(nav, { ym: '202610', prevHref: null, nextHref: '/trend?axis=ch&ym=202611' });
});

test('기준월 쿠키 값도 같은 범위 검사를 탄다', () => {
  assert.ok(isYm('202610'));
  assert.ok(!isYm('2026-10'));
  assert.ok(!isYm(undefined));
  // 지난달에 저장한 쿠키가 다음 달까지 남아도 범위 밖이면 당월
  assert.equal(selectMonth('202610', '20261201').ym, '202612');
});
