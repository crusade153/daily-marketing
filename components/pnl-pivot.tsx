'use client';

import { Fragment, useMemo, useState } from 'react';
import { growth, mil, pct, ppt, tone } from '@/lib/format';
import { axisKey, cmRank, groupBy, metrics, totalOf, type Axis, type Group } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import { SCENARIO_LABEL, type MaterialRow, type Scenario } from '@/lib/types';

// 손익 분석 화면의 축 이름 (사용자 정의: CM › PM › 제품라인 › 품목 › 브랜드)
export const PIVOT_LABEL: Record<Axis, string> = {
  cm: 'CM',
  owner: 'PM(담당자)',
  category: '제품라인',
  l3: '품목(LV3)',
  l1: '브랜드(LV1)',
  l2: '제품계층 LV2',
  l4: '제품계층 LV4',
  name: '제품',
};
const AXES: Axis[] = ['cm', 'owner', 'category', 'l3', 'l1', 'l2', 'l4', 'name'];
const CODED: Axis[] = ['l1', 'l2', 'l3', 'l4', 'name'];
const DEPTH = 5;
type Slot = Axis | 'none';

const PRESETS: { label: string; slots: Slot[] }[] = [
  { label: 'CM › PM › 제품라인 › 품목', slots: ['cm', 'owner', 'category', 'l3', 'none'] },
  { label: '브랜드 › LV2 › 품목 › LV4', slots: ['l1', 'l2', 'l3', 'l4', 'none'] },
  { label: 'CM › 브랜드 › 품목', slots: ['cm', 'l1', 'l3', 'none', 'none'] },
  { label: 'PM › 품목 › 제품', slots: ['owner', 'l3', 'name', 'none', 'none'] },
];
const MOBILE_PAGE = 60;

type Sums = Pick<Group, 'mtd' | 'fcst' | 'prev'>;

function Cells({ g, s, compare, detail }: { g: Sums; s: Scenario; compare: boolean; detail: boolean }) {
  const m = metrics(g[s]);
  const p = metrics(g.prev);
  return (
    <>
      <td className="num grp-start font-semibold">{mil(m.sales)}</td>
      {compare && detail && <td className="num text-muted">{mil(p.sales)}</td>}
      {compare && <td className={`num ${tone(m.sales - p.sales)}`}>{p.sales > 0 ? pct(growth(m.sales, p.sales)) : '-'}</td>}
      {detail && <td className="num grp-start">{mil(m.cogs)}</td>}
      <td className={`num ${detail ? '' : 'grp-start'}`}>{mil(m.gp)}</td>
      <td className={`num ${tone(m.gpm)}`}>{pct(m.gpm)}</td>
      {compare && <td className={`num ${tone((m.gpm ?? 0) - (p.gpm ?? 0))}`}>{ppt(m.gpm, p.gpm)}</td>}
      {detail && <td className="num grp-start">{mil(m.incentive)}</td>}
      {detail && <td className="num">{mil(m.general)}</td>}
      <td className={`num font-semibold ${detail ? '' : 'grp-start'} ${tone(m.op)}`}>{mil(m.op)}</td>
      <td className={`num ${tone(m.opm)}`}>{pct(m.opm)}</td>
      {compare && <td className={`num ${tone((m.opm ?? 0) - (p.opm ?? 0))}`}>{ppt(m.opm, p.opm)}</td>}
    </>
  );
}

/** 모바일 카드 한 장: 이름 + 매출·GP·OP 세 줄 */
function MobileCard({ g, s, compare }: { g: Sums; s: Scenario; compare: boolean }) {
  const m = metrics(g[s]);
  const p = metrics(g.prev);
  return (
    <dl className="m-metrics">
      <div>
        <dt>매출</dt>
        <dd className="font-semibold">{mil(m.sales)}</dd>
        {compare && <dd className={`m-delta ${tone(m.sales - p.sales)}`}>{p.sales > 0 ? pct(growth(m.sales, p.sales)) : '-'}</dd>}
      </div>
      <div>
        <dt>GP</dt>
        <dd>{mil(m.gp)} <small className={tone(m.gpm)}>{pct(m.gpm)}</small></dd>
        {compare && <dd className={`m-delta ${tone((m.gpm ?? 0) - (p.gpm ?? 0))}`}>{ppt(m.gpm, p.gpm)}</dd>}
      </div>
      <div>
        <dt>OP</dt>
        <dd className={tone(m.op)}>{mil(m.op)} <small className={tone(m.opm)}>{pct(m.opm)}</small></dd>
        {compare && <dd className={`m-delta ${tone((m.opm ?? 0) - (p.opm ?? 0))}`}>{ppt(m.opm, p.opm)}</dd>}
      </div>
    </dl>
  );
}

/**
 * 손익 피벗. 1차~5차 축으로 단계별 드릴다운 (기본: CM › PM › 제품라인 › 품목).
 * 장려금·일반비는 품목 단위로 배부돼 있어 어느 축·단계로 묶어도 합계가 같다.
 * PC는 들여쓰기 표, 모바일은 한 단계씩 들어가는 카드 목록으로 보여준다.
 */
export default function PnlPivot({
  rows,
  curYm,
  prevYm,
  exportHref,
}: {
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  exportHref?: string;
}) {
  const [slots, setSlots] = useState<Slot[]>(PRESETS[0].slots);
  const [scenario, setScenario] = useState<Scenario>('fcst');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(false);
  // 모바일 드릴 경로 (각 단계에서 고른 그룹)
  const [trail, setTrail] = useState<{ key: string; label: string }[]>([]);
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE);

  // 실제 드릴 경로: 첫 '없음'에서 끊는다
  const path = useMemo(() => {
    const p: Axis[] = [];
    for (const s of slots) {
      if (s === 'none') break;
      p.push(s);
    }
    return p;
  }, [slots]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.matnr, r.l1t, r.l2t, r.l3t, r.l4t, r.cm, r.category, r.owner].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  const total = useMemo(() => totalOf(filtered), [filtered]);
  const compare = scenario !== 'prev';
  const label = (s: Scenario) => `${monthLabel(s === 'prev' ? prevYm : curYm)} ${SCENARIO_LABEL[s].split(' ')[1]}`;
  // CM은 CM1·CM2·CM3·(미매핑)·기타 순, 나머지는 매출 큰 순
  const sorted = (list: MaterialRow[], axis: Axis) =>
    groupBy(list, axis).sort((a, b) => (axis === 'cm' ? cmRank(a.label) - cmRank(b.label) : 0) || b[scenario].sales - a[scenario].sales);
  const presetIndex = PRESETS.findIndex((p) => p.slots.every((s, i) => s === slots[i]));

  const resetDrill = () => {
    setOpen(new Set());
    setTrail([]);
    setMobileLimit(MOBILE_PAGE);
  };

  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /** depth단계까지 모두 펼친다 (0 = 모두 접기) */
  const expandTo = (depth: number) => {
    const keys = new Set<string>();
    const walk = (list: MaterialRow[], d: number, prefix: string) => {
      if (d >= depth || d >= path.length - 1) return;
      for (const g of groupBy(list, path[d])) {
        const k = `${prefix}/${g.key}`;
        keys.add(k);
        walk(g.rows, d + 1, k);
      }
    };
    walk(filtered, 0, '');
    setOpen(keys);
  };

  const setSlot = (i: number, v: Slot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = v;
      // 같은 축이 두 번 나오지 않게 뒤 단계에서 지운다
      for (let j = i + 1; j < DEPTH; j++) if (next[j] !== 'none' && next.slice(0, j).includes(next[j])) next[j] = 'none';
      // '없음' 뒤는 모두 없음
      const cut = next.indexOf('none');
      return cut < 0 ? next : next.map((s, j) => (j > cut ? 'none' : s));
    });
    resetDrill();
  };

  const nameCell = (axis: Axis, g: Group) => {
    const showCode = CODED.includes(axis) && !g.key.includes(':') && g.key !== '-';
    return { showCode, title: `${PIVOT_LABEL[axis]}: ${g.label}${showCode ? ` (${g.key})` : ''}` };
  };

  const renderLevel = (list: MaterialRow[], depth: number, prefix: string): React.ReactNode =>
    sorted(list, path[depth]).map((g) => {
      const k = `${prefix}/${g.key}`;
      const axis = path[depth];
      const expandable = depth < path.length - 1;
      const isOpen = expandable && open.has(k);
      const { showCode, title } = nameCell(axis, g);
      return (
        <Fragment key={k}>
          <tr className={`${expandable ? 'cursor-pointer' : ''} ${depth === 0 && expandable ? 'subtotal' : ''}`}>
            <td className={`pivot-name ${depth > 0 ? 'text-[12.5px]' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} title={title}>
              <span className="pivot-name-inner">
                {expandable ? (
                  <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="pivot-toggle">
                    <span className="pivot-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span className="truncate">{g.label}</span>
                  </button>
                ) : (
                  <span className="truncate">{g.label}</span>
                )}
                {showCode && <span className="pivot-code">{g.key}</span>}
              </span>
            </td>
            <Cells g={g} s={scenario} compare={compare} detail={detail} />
          </tr>
          {isOpen && renderLevel(g.rows, depth + 1, k)}
        </Fragment>
      );
    });

  // 모바일: 드릴 경로로 좁힌 행과 현재 단계 그룹
  const mobileLevel = Math.min(trail.length, path.length - 1);
  const mobileRows = useMemo(
    () => filtered.filter((r) => trail.every((t, i) => axisKey(r, path[i]) === t.key)),
    [filtered, trail, path],
  );
  const mobileGroups = path.length ? sorted(mobileRows, path[mobileLevel]) : [];
  const mobileTotal = useMemo(() => totalOf(mobileRows), [mobileRows]);
  const canDrill = mobileLevel < path.length - 1;

  const scenarioButtons = (
    <div className="pivot-scenario" role="group" aria-label="기간">
      {(['mtd', 'fcst', 'prev'] as Scenario[]).map((s) => (
        <button key={s} type="button" aria-pressed={scenario === s} onClick={() => setScenario(s)}>
          {label(s)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="card pivot-card">
      <div className="pivot-controls">
        <div className="pivot-row">
          {scenarioButtons}
          <label className="pivot-field">
            <span>분석 순서</span>
            <select
              value={presetIndex}
              onChange={(e) => {
                const i = Number(e.target.value);
                if (i >= 0) {
                  setSlots(PRESETS[i].slots);
                  resetDrill();
                }
              }}
            >
              {presetIndex < 0 && <option value={-1}>직접 선택</option>}
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>{p.label}</option>
              ))}
            </select>
          </label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetDrill();
            }}
            placeholder="CM·PM·품목·제품 검색"
            aria-label="손익 검색"
            className="pivot-search"
          />
          <div className="segmented only-pc" role="group" aria-label="표시할 손익 지표">
            <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>핵심 지표</button>
            <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>전체 지표</button>
          </div>
          {exportHref && (
            <a href={exportHref} download className="pivot-export only-pc" title="제품별 손익 원천 (당월 누계·예상·전월, 올해 월별)">
              원천 다운로드
            </a>
          )}
        </div>
        <div className="pivot-row only-pc">
          {slots.map((s, i) => (
            <label key={i} className="pivot-slot">
              <span>계층{i + 1}</span>
              <select value={s} disabled={i > 0 && slots[i - 1] === 'none'} onChange={(e) => setSlot(i, e.target.value as Slot)}>
                {i > 0 && <option value="none">없음</option>}
                {AXES.filter((a) => a === s || !slots.slice(0, i).includes(a)).map((a) => (
                  <option key={a} value={a}>{PIVOT_LABEL[a]}</option>
                ))}
              </select>
            </label>
          ))}
          {path.length > 1 && (
            <div className="flex gap-1 text-xs">
              {path.slice(1).map((_, i) => (
                <button key={i} type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandTo(i + 1)}>
                  {i + 2}단계 펼침
                </button>
              ))}
              <button type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandTo(0)}>
                모두 접기
              </button>
            </div>
          )}
          <span className="ml-auto text-xs text-muted">단위: 백만원 · 전월비 매출 %, 이익 %p</span>
        </div>
      </div>

      {/* PC: 들여쓰기 피벗 표 */}
      <div className="data-scroll only-pc">
        <table className="dtable pivot-dtable">
          <thead>
            <tr className="pivot-group-row">
              <th rowSpan={2} className="pivot-name text-left">{path.map((a) => PIVOT_LABEL[a]).join(' › ')}</th>
              <th colSpan={1 + (compare ? 1 : 0) + (compare && detail ? 1 : 0)} className="grp-start">매출</th>
              <th colSpan={2 + (compare ? 1 : 0) + (detail ? 1 : 0)} className="grp-start">매출이익 (GP)</th>
              <th colSpan={2 + (compare ? 1 : 0) + (detail ? 2 : 0)} className="grp-start">영업이익 (OP)</th>
            </tr>
            <tr>
              <th className="num grp-start">실적</th>
              {compare && detail && <th className="num">전월</th>}
              {compare && <th className="num">전월비</th>}
              {detail && <th className="num grp-start">매출원가</th>}
              <th className={`num ${detail ? '' : 'grp-start'}`}>GP</th>
              <th className="num">GP율</th>
              {compare && <th className="num">전월비</th>}
              {detail && <th className="num grp-start">장려금</th>}
              {detail && <th className="num">일반비</th>}
              <th className={`num ${detail ? '' : 'grp-start'}`}>OP</th>
              <th className="num">OP율</th>
              {compare && <th className="num">전월비</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td className="pivot-name">합계</td>
              <Cells g={total} s={scenario} compare={compare} detail={detail} />
            </tr>
            {path.length > 0 && renderLevel(filtered, 0, '')}
          </tbody>
        </table>
      </div>

      {/* 모바일: 한 단계씩 들어가는 카드 */}
      <div className="m-pivot only-mobile">
        <nav className="m-trail" aria-label="드릴다운 경로">
          <button type="button" onClick={() => { setTrail([]); setMobileLimit(MOBILE_PAGE); }} aria-current={trail.length === 0 ? 'page' : undefined}>전체</button>
          {trail.map((t, i) => (
            <Fragment key={`${i}-${t.key}`}>
              <i aria-hidden="true">›</i>
              <button type="button" onClick={() => { setTrail(trail.slice(0, i + 1)); setMobileLimit(MOBILE_PAGE); }} aria-current={i === trail.length - 1 ? 'page' : undefined}>
                {t.label}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="m-card m-total">
          <div className="m-card-head">
            <b>{trail.length ? trail[trail.length - 1].label : '합계'}</b>
            <span>{path.length ? `${PIVOT_LABEL[path[mobileLevel]]} ${mobileGroups.length}개` : ''}</span>
          </div>
          <MobileCard g={mobileTotal} s={scenario} compare={compare} />
        </div>
        <ul className="m-list">
          {mobileGroups.slice(0, mobileLimit).map((g) => {
            const { showCode } = nameCell(path[mobileLevel], g);
            const body = (
              <>
                <div className="m-card-head">
                  <b>{g.label}</b>
                  {showCode && <span className="pivot-code">{g.key}</span>}
                  {canDrill && <span className="m-chevron" aria-hidden="true">›</span>}
                </div>
                <MobileCard g={g} s={scenario} compare={compare} />
              </>
            );
            return (
              <li key={g.key}>
                {canDrill ? (
                  <button
                    type="button"
                    className="m-card"
                    onClick={() => {
                      setTrail([...trail.slice(0, mobileLevel), { key: g.key, label: g.label }]);
                      setMobileLimit(MOBILE_PAGE);
                      window.scrollTo({ top: 0 });
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="m-card">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        {mobileGroups.length > mobileLimit && (
          <button type="button" className="m-more" onClick={() => setMobileLimit((n) => n + MOBILE_PAGE)}>
            {Math.min(MOBILE_PAGE, mobileGroups.length - mobileLimit)}개 더 보기 (남은 {mobileGroups.length - mobileLimit}개)
          </button>
        )}
        <p className="m-foot">단위: 백만원 · 전월비 매출 %, GP·OP는 이익률 %p</p>
      </div>
    </div>
  );
}
