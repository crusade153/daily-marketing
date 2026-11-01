'use client';

import { useMemo, useState } from 'react';
import { mil, signedMil } from '@/lib/format';
import { GRADE_ACTION, GRADE_NAME, QUADRANTS, type Quadrant } from '@/lib/segment';
import type { GradeChange } from '@/lib/grade';
import { GradeChip, GradeShift } from './grade-chip';

const SHOW = 4;
const minus = (s: string) => s.replace('-', '−');

/**
 * 손익 화면 맨 앞의 등급 신호등: 등급별 품목 수 변화와 악화·개선 품목.
 * 영업이익 변화가 큰 순이라 위에서부터 손보면 된다. 품목을 누르면 아래 표를 그 제품으로 좁힌다.
 */
export default function GradeAlert({
  changes,
  fromLabel,
  toLabel,
  unitLabel,
  picked,
  onPick,
}: {
  changes: GradeChange[];
  fromLabel: string;
  toLabel: string;
  unitLabel: string;
  picked: string | null;
  onPick: (c: GradeChange | null) => void;
}) {
  const [focus, setFocus] = useState<Quadrant | null>(null);
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState(false);

  const stat = useMemo(() => {
    const s = Object.fromEntries(QUADRANTS.map((q) => [q, { now: 0, before: 0, op: 0 }])) as Record<Quadrant, { now: number; before: number; op: number }>;
    let same = 0;
    let fresh = 0;
    let gone = 0;
    for (const c of changes) {
      if (c.to) {
        s[c.to].now += 1;
        s[c.to].op += c.opTo;
      }
      if (c.from) s[c.from].before += 1;
      if (c.trend === 'same') same += 1;
      else if (c.trend === 'new') fresh += 1;
      else if (c.trend === 'gone') gone += 1;
    }
    return { s, same, fresh, gone };
  }, [changes]);

  const lists = useMemo(() => {
    const inFocus = (c: GradeChange) => !focus || c.from === focus || c.to === focus;
    const delta = (c: GradeChange) => c.opTo - c.opFrom;
    const down = changes.filter((c) => c.trend === 'down' && inFocus(c)).sort((a, b) => delta(a) - delta(b));
    const up = changes.filter((c) => c.trend === 'up' && inFocus(c)).sort((a, b) => delta(b) - delta(a));
    const sum = (l: GradeChange[]) => l.reduce((t, c) => t + delta(c), 0);
    return { down, up, downOp: sum(down), upOp: sum(up) };
  }, [changes, focus]);

  const item = (c: GradeChange) => {
    const d = c.opTo - c.opFrom;
    return (
      <li key={c.key}>
        <button type="button" className={`ga-item ${picked === c.key ? 'is-picked' : ''}`} onClick={() => onPick(picked === c.key ? null : c)} title={`${c.matnr} ${c.name}${c.cht ? ` · ${c.cht}` : ''} — 누르면 아래 표를 이 제품으로 좁힙니다`}>
          <GradeShift from={c.from} to={c.to} trend={c.trend} compact />
          <span className="ga-name">
            <b>{c.name}</b>
            <small>
              {c.cht ? `${c.cht} · ` : ''}
              {c.shift && <em className={c.shift === '적자 전환' ? 'is-alarm' : c.shift === '흑자 전환' ? 'is-good' : ''}>{c.shift}</em>}
              {c.to && <> · {GRADE_ACTION[c.to]}</>}
            </small>
          </span>
          <span className="ga-op num">
            <small>영업이익 {minus(mil(c.opFrom))} → {minus(mil(c.opTo))}</small>
            <b className={d < 0 ? 'text-neg' : 'text-pos'}>{minus(signedMil(d))}</b>
          </span>
        </button>
      </li>
    );
  };

  const col = (kind: 'down' | 'up') => {
    const list = kind === 'down' ? lists.down : lists.up;
    const op = kind === 'down' ? lists.downOp : lists.upOp;
    return (
      <div className={`ga-col ga-${kind}`}>
        <h3>
          <span>{kind === 'down' ? '▼ 악화' : '▲ 개선'}</span>
          <b className="num">{list.length.toLocaleString()}개</b>
          <small className="num">영업이익 {minus(signedMil(op))}백만</small>
        </h3>
        {list.length ? (
          <ol className={all ? 'is-all' : ''}>{(all ? list : list.slice(0, SHOW)).map(item)}</ol>
        ) : (
          <p className="ga-empty">{kind === 'down' ? '등급이 내려간' : '등급이 오른'} {unitLabel}이 없습니다.</p>
        )}
      </div>
    );
  };

  const more = Math.max(lists.down.length, lists.up.length) > SHOW;

  return (
    <section className={`card grade-alert ${hidden ? 'is-hidden' : ''}`} aria-labelledby="ga-title">
      <div className="ga-head">
        <h2 id="ga-title">등급 신호등</h2>
        <span className="text-muted">
          {fromLabel} → {toLabel} · {unitLabel} {changes.length.toLocaleString()}개 · 영업이익 변화 큰 순
        </span>
        {focus && (
          <button type="button" className="seg-link" onClick={() => setFocus(null)}>
            {focus} 필터 해제
          </button>
        )}
        {picked && (
          <button type="button" className="seg-link" onClick={() => onPick(null)}>
            표 좁히기 해제
          </button>
        )}
        <span className="ga-tools">
          {!hidden && more && (
            <button type="button" onClick={() => setAll((v) => !v)}>
              {all ? '접기' : '전체 보기'}
            </button>
          )}
          <button type="button" onClick={() => setHidden((v) => !v)} aria-expanded={!hidden}>
            {hidden ? '펼치기' : '숨기기'}
          </button>
        </span>
      </div>
      {!hidden && (
        <div className="ga-body">
          <div className="ga-tiles" role="group" aria-label="등급별 품목 수 (누르면 그 등급이 들고 난 품목만)">
            {QUADRANTS.map((q) => {
              const s = stat.s[q];
              const d = s.now - s.before;
              return (
                <button key={q} type="button" className={`ga-tile g-${q}`} aria-pressed={focus === q} onClick={() => setFocus((f) => (f === q ? null : q))}>
                  <GradeChip q={q} />
                  <span className="ga-tile-name">{GRADE_NAME[q]}</span>
                  <b className="num">
                    {s.now.toLocaleString()}
                    <small>개</small>
                  </b>
                  <span className={`ga-tile-delta num ${d === 0 ? 'text-muted' : (q === 'A' || q === 'C') === d > 0 ? 'text-pos' : 'text-neg'}`}>
                    {d === 0 ? '변동 없음' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`}
                  </span>
                  <span className="ga-tile-op num">OP {minus(mil(s.op))}</span>
                </button>
              );
            })}
          </div>
          {col('down')}
          {col('up')}
          <p className="ga-foot">
            유지 {stat.same.toLocaleString()} · 신규 {stat.fresh.toLocaleString()} · 판매 없음 {stat.gone.toLocaleString()} · 등급 = 순매출 5천만원 이상(규모) × 영업이익 0 이상(손익+) · 금액 백만원
          </p>
        </div>
      )}
    </section>
  );
}
