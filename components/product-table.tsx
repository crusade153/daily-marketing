'use client';

import { useMemo, useState } from 'react';
import { growth, mil, pct, tone, won } from '@/lib/format';
import { changeOf, gradeChanges, gradePair, type GradeChange } from '@/lib/grade';
import { metrics, unitPrice, type Metrics } from '@/lib/pnl';
import { monthLabel, shiftYm } from '@/lib/period';
import { GRADE_RANK } from '@/lib/segment';
import { SCENARIO_LABEL, type MaterialRow, type Scenario } from '@/lib/types';
import GradeAlert from './grade-alert';
import { GradeShift } from './grade-chip';

const PAGE = 200;
const KEY_COLS = new Set(['matnr', 'name', 'grade', 'cm', 'owner', 'l1', 'qty', 'price', 'sales', 'gp', 'gpm', 'op', 'growth', 'pprice', 'pchg']);
const TEXT_COLS = ['matnr', 'name', 'cm', 'owner', 'category', 'l1'];
const MOBILE_SORTS = [
  { id: 'sales', label: '매출순' },
  { id: 'gp', label: 'GP순' },
  { id: 'op', label: 'OP순' },
  { id: 'grade', label: '등급 악화순' },
  { id: 'growth', label: '매출 증감순' },
  { id: 'price', label: '판매단가순' },
];
const qtyFmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

interface Ctx {
  m: Metrics;
  p: Metrics;
  price: number | null;
  prevPrice: number | null;
  grade: ReturnType<typeof changeOf>;
}

interface Col {
  id: string;
  label: string;
  title?: string;
  num?: boolean;
  compare?: boolean; // 전월 비교 열 (전월 실적 보기는 전전월과 비교)
  sort: (r: MaterialRow, c: Ctx) => number | string | null;
  cell: (r: MaterialRow, c: Ctx) => React.ReactNode;
  className?: (r: MaterialRow, c: Ctx) => string;
}

const priceChg = (c: Ctx) => (c.price != null && c.prevPrice ? c.price / c.prevPrice - 1 : null);

const COLS: Col[] = [
  { id: 'matnr', label: '제품코드', sort: (r) => r.matnr, cell: (r) => r.matnr },
  { id: 'name', label: '제품명', sort: (r) => r.name, cell: (r) => r.name },
  {
    id: 'grade',
    label: '등급',
    title: 'ABCD 등급 전월 → 당월 (순매출 5천만원 × 영업이익 0 기준). 오름차순 = 악화 큰 순',
    // 등급 차이(올라가면 +). 신규·판매 없음은 맨 뒤
    sort: (_, c) => (c.grade?.from && c.grade.to ? GRADE_RANK[c.grade.to] - GRADE_RANK[c.grade.from] : null),
    cell: (_, c) => (c.grade ? <GradeShift from={c.grade.from} to={c.grade.to} trend={c.grade.trend} compact /> : '-'),
  },
  { id: 'cm', label: 'CM', sort: (r) => r.cm, cell: (r) => r.cm },
  { id: 'owner', label: 'PM', sort: (r) => r.owner, cell: (r) => r.owner },
  { id: 'category', label: '제품라인', sort: (r) => r.category, cell: (r) => r.category },
  { id: 'l1', label: '브랜드', sort: (r) => r.l1t, cell: (r) => r.l1t },
  { id: 'qty', label: '수량(EA)', num: true, sort: (_, c) => c.m.qty, cell: (_, c) => qtyFmt.format(c.m.qty) },
  {
    id: 'price',
    label: '판매단가(원)',
    title: '총매출 ÷ 판매수량(EA)',
    num: true,
    sort: (_, c) => c.price,
    cell: (_, c) => (c.price == null ? '-' : won(c.price)),
  },
  { id: 'sales', label: '총매출', num: true, sort: (_, c) => c.m.sales, cell: (_, c) => mil(c.m.sales), className: () => 'font-semibold' },
  { id: 'inc', label: '장려금', num: true, sort: (_, c) => c.m.incentive, cell: (_, c) => mil(c.m.incentive) },
  { id: 'net', label: '순매출', num: true, sort: (_, c) => c.m.net, cell: (_, c) => mil(c.m.net) },
  { id: 'cogs', label: '매출원가', num: true, sort: (_, c) => c.m.cogs, cell: (_, c) => mil(c.m.cogs) },
  { id: 'gp', label: '매출총이익', num: true, sort: (_, c) => c.m.gp, cell: (_, c) => mil(c.m.gp) },
  { id: 'gpm', label: 'GP율', num: true, sort: (_, c) => c.m.gpm, cell: (_, c) => pct(c.m.gpm), className: (_, c) => tone(c.m.gpm) },
  { id: 'gen', label: '일반비', num: true, sort: (_, c) => c.m.general, cell: (_, c) => mil(c.m.general) },
  { id: 'op', label: '영업이익', num: true, sort: (_, c) => c.m.op, cell: (_, c) => mil(c.m.op), className: (_, c) => `font-semibold ${tone(c.m.op)}` },
  { id: 'opm', label: 'OP율', num: true, sort: (_, c) => c.m.opm, cell: (_, c) => pct(c.m.opm), className: (_, c) => tone(c.m.opm) },
  {
    id: 'psales',
    label: '전월 매출',
    num: true,
    compare: true,
    sort: (_, c) => c.p.sales,
    cell: (_, c) => mil(c.p.sales),
    className: () => 'border-l border-border text-muted',
  },
  {
    id: 'growth',
    label: '매출 증감',
    num: true,
    compare: true,
    sort: (_, c) => (c.p.sales > 0 ? growth(c.m.sales, c.p.sales) : null),
    cell: (_, c) => (c.p.sales > 0 ? pct(growth(c.m.sales, c.p.sales)) : '-'),
    className: (_, c) => tone(c.m.sales - c.p.sales),
  },
  {
    id: 'pprice',
    label: '전월 단가(원)',
    num: true,
    compare: true,
    sort: (_, c) => c.prevPrice,
    cell: (_, c) => (c.prevPrice == null ? '-' : won(c.prevPrice)),
    className: () => 'text-muted',
  },
  {
    id: 'pchg',
    label: '단가 증감',
    num: true,
    compare: true,
    sort: (_, c) => priceChg(c),
    cell: (_, c) => pct(priceChg(c)),
    className: (_, c) => tone(priceChg(c)),
  },
];

export default function ProductTable({ rows, curYm, prevYm }: { rows: MaterialRow[]; curYm: string; prevYm: string }) {
  const [scenario, setScenario] = useState<Scenario>('mtd');
  const [l1, setL1] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: 'sales', desc: true });
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState(false);

  // 고른 기간의 '전월': 누계·예상은 전월 실적, 전월 실적 보기는 전전월 실적
  const base = scenario === 'prev' ? 'prev2' : 'prev';
  const cols = COLS.filter((c) => detail || KEY_COLS.has(c.id));
  const pair = gradePair(scenario);
  const changes = useMemo(() => gradeChanges(rows, false, pair.from, pair.to), [rows, pair.from, pair.to]);
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (c: GradeChange | null) => {
    setPicked(c?.key ?? null);
    setQuery(c?.matnr ?? '');
    setL1('');
    setLimit(PAGE);
  };

  const l1s = useMemo(() => {
    const m = new Map<string, { label: string; sales: number }>();
    for (const r of rows) {
      const v = m.get(r.l1) ?? { label: r.l1t, sales: 0 };
      v.sales += r.mtd.sales + r.prev.sales;
      m.set(r.l1, v);
    }
    return [...m].sort((a, b) => b[1].sales - a[1].sales);
  }, [rows]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const col = COLS.find((c) => c.id === sort.id) ?? COLS.find((c) => c.id === 'sales')!;
    const withCtx = rows
      .filter((r) => !l1 || r.l1 === l1)
      .filter((r) => !q || [r.matnr, r.name, r.l1t, r.cm, r.owner, r.category].some((v) => v.toLowerCase().includes(q)))
      .map((r) => {
        const ctx: Ctx = {
          m: metrics(r[scenario]),
          p: metrics(r[base]),
          price: unitPrice(r[scenario]),
          prevPrice: unitPrice(r[base]),
          grade: changeOf(r[pair.from], r[pair.to]),
        };
        return { r, ctx, key: col.sort(r, ctx) };
      });
    const dir = sort.desc ? -1 : 1;
    withCtx.sort((a, b) => {
      // 값이 없는 행은 방향과 관계없이 맨 뒤
      if (a.key == null) return b.key == null ? 0 : 1;
      if (b.key == null) return -1;
      if (typeof a.key === 'string') return a.key.localeCompare(String(b.key)) * dir;
      return ((a.key as number) - (b.key as number)) * dir;
    });
    return withCtx;
  }, [rows, l1, query, scenario, base, sort, pair.from, pair.to]);

  const total = useMemo(() => {
    const t = { sales: 0, cogs: 0, incentive: 0, general: 0, qty: 0 };
    for (const { r } of list) {
      const a = r[scenario];
      t.sales += a.sales;
      t.cogs += a.cogs;
      t.incentive += a.incentive;
      t.general += a.general;
    }
    return metrics(t);
  }, [list, scenario]);

  const onSort = (id: string) => {
    // 등급은 악화 큰 순(오름차순)부터
    setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: !TEXT_COLS.includes(id) && id !== 'grade' }));
    setLimit(PAGE);
  };
  const label = (s: Scenario) => `${monthLabel(s === 'prev' ? prevYm : curYm)} ${SCENARIO_LABEL[s].split(' ')[1]}`;
  const totals: Record<string, string> = {
    matnr: '합계', name: l1 ? l1s.find(([k]) => k === l1)?.[1].label ?? '' : '전체 제품',
    sales: mil(total.sales), net: mil(total.net), cogs: mil(total.cogs), gp: mil(total.gp), gpm: pct(total.gpm),
    inc: mil(total.incentive), gen: mil(total.general), op: mil(total.op), opm: pct(total.opm),
  };

  const periodName = (p: 'prev2' | Scenario) => (p === 'prev2' ? `${monthLabel(shiftYm(prevYm, -1))} 실적` : label(p));

  return (
    <>
    <GradeAlert changes={changes} fromLabel={periodName(pair.from)} toLabel={periodName(pair.to)} unitLabel="제품" picked={picked} onPick={pick} />
    <div className="card">
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
        <label className="flex items-center gap-1.5">
          <span className="text-muted">브랜드</span>
          <select
            value={l1}
            onChange={(e) => {
              setL1(e.target.value);
              setLimit(PAGE);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1.5"
          >
            <option value="">전체</option>
            {l1s.map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
            setLimit(PAGE);
          }}
          placeholder="제품코드·제품명·CM·PM 검색"
          aria-label="제품 검색"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5"
        />
        <select
          className="only-mobile rounded-md border border-border bg-surface px-2 py-1.5"
          aria-label="정렬"
          value={sort.id}
          onChange={(e) => {
            setSort({ id: e.target.value, desc: e.target.value !== 'grade' });
            setLimit(PAGE);
          }}
        >
          {MOBILE_SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          {!MOBILE_SORTS.some((o) => o.id === sort.id) && <option value={sort.id}>{COLS.find((c) => c.id === sort.id)?.label}순</option>}
        </select>
        <div className="segmented only-pc" role="group" aria-label="표시할 제품 지표">
          <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>핵심 지표</button>
          <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>전체 지표</button>
        </div>
        <span className="ml-auto text-xs text-muted">
          {list.length.toLocaleString()}개 제품 · 금액 백만원, 단가 원/EA<span className="only-pc"> · 머리글을 누르면 정렬</span>
        </span>
      </div>
      <div className="data-scroll only-pc">
        <table className="dtable product-dtable">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={c.id}
                  className={`${c.num ? 'num' : 'text-left'} ${i === 0 ? 'sticky left-0 z-[3]' : ''} ${c.compare && c.id === 'psales' ? 'border-l border-border' : ''}`}
                  title={c.title}
                  aria-sort={sort.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined}
                >
                  <button type="button" onClick={() => onSort(c.id)} className="hover:text-text">
                    {c.label}
                    {sort.id === c.id && <span className="ml-0.5">{sort.desc ? '▾' : '▴'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              {cols.map((c) => <td key={c.id} className={c.num ? 'num' : ''}>{totals[c.id] ?? (c.num ? '−' : '')}</td>)}
            </tr>
            {list.slice(0, limit).map(({ r, ctx }) => (
              <tr key={r.matnr}>
                {cols.map((c, i) => {
                  const text = !c.num && c.id !== 'grade';
                  return (
                    <td
                      key={c.id}
                      className={`${c.num ? 'num' : 'max-w-[220px] truncate'} ${i === 0 ? 'sticky left-0 z-[1] bg-surface font-mono text-[12px]' : ''} ${
                        c.className?.(r, ctx) ?? ''
                      } ${text && i > 1 ? 'text-[12.5px] text-muted' : ''}`}
                      title={text ? String(c.sort(r, ctx) ?? '') : undefined}
                    >
                      {c.cell(r, ctx)}
                      {c.id === 'name' && r.costMethod === 'rate' && (
                        <span
                          className="ml-1.5 rounded bg-[var(--warn-bg)] px-1 py-0.5 text-[10px] text-[var(--warn-text)]"
                          title="3개월 원가 이력이 없어 계층 원가율로 대체"
                        >
                          원가 대체
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > limit && (
          <div className="border-t border-border p-3 text-center">
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="rounded-md px-4 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
              {Math.min(PAGE, list.length - limit)}개 더 보기 (남은 {(list.length - limit).toLocaleString()}개)
            </button>
          </div>
        )}
      </div>
      <ul className="m-list m-products only-mobile">
        {list.slice(0, limit).map(({ r, ctx }) => {
          const chg = ctx.p.sales > 0 ? growth(ctx.m.sales, ctx.p.sales) : null;
          return (
            <li key={r.matnr} className="m-card">
              <div className="m-card-head">
                <b>{r.name}</b>
                {r.costMethod === 'rate' && <span className="m-tag">원가 대체</span>}
              </div>
              <p className="m-sub">{r.matnr} · {r.l1t} · CM {r.cm} · PM {r.owner}</p>
              {ctx.grade && ctx.grade.trend !== 'same' && (
                <p className="m-grade">
                  등급 <GradeShift from={ctx.grade.from} to={ctx.grade.to} trend={ctx.grade.trend} />
                  {ctx.grade.shift && <span> · {ctx.grade.shift}</span>}
                </p>
              )}
              <dl className="m-metrics">
                <div><dt>매출</dt><dd className="font-semibold">{mil(ctx.m.sales)}</dd><dd className={`m-delta ${tone(chg)}`}>{pct(chg)}</dd></div>
                <div><dt>GP</dt><dd>{mil(ctx.m.gp)} <small className={tone(ctx.m.gpm)}>{pct(ctx.m.gpm)}</small></dd></div>
                <div><dt>단가(원)</dt><dd>{ctx.price == null ? '-' : won(ctx.price)}</dd><dd className={`m-delta ${tone(priceChg(ctx))}`}>{pct(priceChg(ctx))}</dd></div>
              </dl>
            </li>
          );
        })}
        {list.length > limit && (
          <li>
            <button type="button" className="m-more" onClick={() => setLimit((n) => n + PAGE)}>
              {Math.min(PAGE, list.length - limit)}개 더 보기 (남은 {(list.length - limit).toLocaleString()}개)
            </button>
          </li>
        )}
      </ul>
    </div>
    </>
  );
}
