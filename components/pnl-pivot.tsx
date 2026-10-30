'use client';

import { Fragment, useMemo, useState } from 'react';
import { growth, mil, pct, ppt, tone } from '@/lib/format';
import { AXIS_LABEL, groupBy, metrics, totalOf, type Axis, type Group } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import { SCENARIO_LABEL, type MaterialRow, type Scenario } from '@/lib/types';

// 제품 단위는 '제품별 매출' 화면에서 본다
const AXES: Axis[] = ['l1', 'l2', 'l3', 'l4', 'cm', 'category', 'owner'];
const HIER: Axis[] = ['l1', 'l2', 'l3', 'l4'];
const DEPTH = 4;
type Slot = Axis | 'none';

function Cells({ g, s, compare, detail }: { g: Pick<Group, 'mtd' | 'fcst' | 'prev'>; s: Scenario; compare: boolean; detail: boolean }) {
  const m = metrics(g[s]);
  const p = metrics(g.prev);
  return (
    <>
      <td className="num font-semibold">{mil(m.sales)}</td>
      {detail && <td className="num">{mil(m.cogs)}</td>}
      <td className="num">{mil(m.gp)}</td>
      <td className={`num ${tone(m.gpm)}`}>{pct(m.gpm)}</td>
      {detail && <td className="num">{mil(m.incentive)}</td>}
      {detail && <td className="num">{mil(m.general)}</td>}
      <td className={`num font-semibold ${tone(m.op)}`}>{mil(m.op)}</td>
      <td className={`num ${tone(m.opm)}`}>{pct(m.opm)}</td>
      {compare && (
        <>
          <td className="num border-l border-border text-muted">{mil(p.sales)}</td>
          <td className={`num ${tone(m.sales - p.sales)}`}>{p.sales > 0 ? pct(growth(m.sales, p.sales)) : '-'}</td>
          {detail && <td className="num text-muted">{pct(p.opm)}</td>}
          {detail && <td className={`num ${tone((m.opm ?? 0) - (p.opm ?? 0))}`}>{ppt(m.opm, p.opm)}</td>}
        </>
      )}
    </>
  );
}

/**
 * 손익 피벗. 1차~4차 축으로 단계별 드릴다운 (기본: 제품계층 LV1 › LV2 › LV3 › LV4).
 * 장려금·일반비는 품목 단위로 배부돼 있어 어느 축·단계로 묶어도 합계가 같다.
 */
export default function PnlPivot({
  rows,
  curYm,
  prevYm,
  controls = true,
  exportHref,
}: {
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  controls?: boolean;
  exportHref?: string;
}) {
  const [slots, setSlots] = useState<Slot[]>(HIER);
  const [scenario, setScenario] = useState<Scenario>('fcst');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(false);

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
  const sorted = (list: MaterialRow[], axis: Axis) => groupBy(list, axis).sort((a, b) => b[scenario].sales - a[scenario].sales);

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
      return next;
    });
    setOpen(new Set());
  };

  const renderLevel = (list: MaterialRow[], depth: number, prefix: string): React.ReactNode =>
    sorted(list, path[depth]).map((g) => {
      const k = `${prefix}/${g.key}`;
      const axis = path[depth];
      const expandable = depth < path.length - 1;
      const isOpen = expandable && open.has(k);
      const showCode = HIER.includes(axis) && !g.key.includes(':') && g.key !== '-';
      return (
        <Fragment key={k}>
          <tr
            className={`${expandable ? 'cursor-pointer' : ''} ${depth === 0 && expandable ? 'subtotal' : ''}`}
          >
            <td
              className={`max-w-[360px] truncate ${depth > 0 ? 'text-[12.5px]' : ''}`}
              style={{ paddingLeft: 10 + depth * 18 }}
              title={`${AXIS_LABEL[axis]}: ${g.label}${showCode ? ` (${g.key})` : ''}`}
            >
              {expandable ? <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="text-left hover:text-accent"><span className="mr-1.5 inline-block w-3 text-muted" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>{g.label}</button> : g.label}
              {showCode && <span className="ml-1.5 text-[11px] font-normal text-muted">{g.key}</span>}
            </td>
            <Cells g={g} s={scenario} compare={compare} detail={detail} />
          </tr>
          {isOpen && renderLevel(g.rows, depth + 1, k)}
        </Fragment>
      );
    });

  return (
    <div className="card">
      {controls && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(['mtd', 'fcst', 'prev'] as Scenario[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scenario === s}
                onClick={() => setScenario(s)}
                className={`px-3 py-1.5 ${scenario === s ? 'bg-accent text-white' : 'hover:bg-surface-2'}`}
              >
                {label(s)}
              </button>
            ))}
          </div>
          {slots.map((s, i) => (
            <label key={i} className="flex items-center gap-1">
              <span className="text-muted">{i + 1}차</span>
              <select
                value={s}
                disabled={i > 0 && slots[i - 1] === 'none'}
                onChange={(e) => setSlot(i, e.target.value as Slot)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 disabled:opacity-40"
              >
                {i > 0 && <option value="none">없음</option>}
                {AXES.filter((a) => a === s || !slots.slice(0, i).includes(a)).map((a) => (
                  <option key={a} value={a}>
                    {AXIS_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제품·계층·담당자 검색"
            aria-label="계층 및 제품 검색"
            className="min-w-[160px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5"
          />
          <div className="segmented" role="group" aria-label="표시할 손익 지표">
            <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>핵심 지표</button>
            <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>전체 지표</button>
          </div>
          {path.length > 1 && (
            <div className="flex gap-1 text-xs">
              {path.slice(1).map((_, i) => (
                <button key={i} type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandTo(i + 1)}>
                  {i + 2}차까지 펼침
                </button>
              ))}
              <button type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandTo(0)}>
                모두 접기
              </button>
            </div>
          )}
          {exportHref && (
            <a
              href={exportHref}
              download
              className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-surface-2"
              title="제품별 손익 원천 (당월 누계·예상·전월, 올해 월별)"
            >
              원천 데이터 다운로드
            </a>
          )}
          <span className="ml-auto text-xs text-muted">단위: 백만원</span>
        </div>
      )}
      <div className="data-scroll">
        <table className="dtable hierarchy-dtable">
          <thead>
            <tr>
              <th className="text-left">{path.map((a) => AXIS_LABEL[a]).join(' › ')}</th>
              <th className="num">매출</th>
              {detail && <th className="num">매출원가</th>}
              <th className="num">매출이익</th>
              <th className="num">이익률</th>
              {detail && <th className="num">장려금</th>}
              {detail && <th className="num">일반비</th>}
              <th className="num">영업이익</th>
              <th className="num">영업이익률</th>
              {compare && (
                <>
                  <th className="num border-l border-border">전월 매출</th>
                  <th className="num">매출 증감</th>
                  {detail && <th className="num">전월 영업이익률</th>}
                  {detail && <th className="num">영업이익률 차이</th>}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td>합계</td>
              <Cells g={total} s={scenario} compare={compare} detail={detail} />
            </tr>
            {renderLevel(filtered, 0, '')}
          </tbody>
        </table>
      </div>
    </div>
  );
}
