'use client';

import { useMemo, useState } from 'react';
import { growth, mil, pct, tone, won } from '@/lib/format';
import { metrics, unitPrice, type Metrics } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import { SCENARIO_LABEL, type MaterialRow, type Scenario } from '@/lib/types';

const PAGE = 200;
const qtyFmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

interface Ctx {
  m: Metrics;
  p: Metrics;
  price: number | null;
  prevPrice: number | null;
}

interface Col {
  id: string;
  label: string;
  title?: string;
  num?: boolean;
  compare?: boolean; // 전월 비교 열 (전월 실적 보기에서는 숨김)
  sort: (r: MaterialRow, c: Ctx) => number | string | null;
  cell: (r: MaterialRow, c: Ctx) => React.ReactNode;
  className?: (r: MaterialRow, c: Ctx) => string;
}

const priceChg = (c: Ctx) => (c.price != null && c.prevPrice ? c.price / c.prevPrice - 1 : null);

const COLS: Col[] = [
  { id: 'matnr', label: '제품코드', sort: (r) => r.matnr, cell: (r) => r.matnr },
  { id: 'name', label: '제품명', sort: (r) => r.name, cell: (r) => r.name },
  { id: 'l1', label: 'LV1', sort: (r) => r.l1t, cell: (r) => r.l1t },
  { id: 'l2', label: 'LV2', sort: (r) => r.l2t, cell: (r) => r.l2t },
  { id: 'l3', label: 'LV3', sort: (r) => r.l3t, cell: (r) => r.l3t },
  { id: 'l4', label: 'LV4', sort: (r) => r.l4t, cell: (r) => r.l4t },
  { id: 'qty', label: '수량(EA)', num: true, sort: (_, c) => c.m.qty, cell: (_, c) => qtyFmt.format(c.m.qty) },
  {
    id: 'price',
    label: '판매단가(원)',
    title: '매출 ÷ 판매수량(EA)',
    num: true,
    sort: (_, c) => c.price,
    cell: (_, c) => (c.price == null ? '-' : won(c.price)),
  },
  { id: 'sales', label: '매출', num: true, sort: (_, c) => c.m.sales, cell: (_, c) => mil(c.m.sales), className: () => 'font-semibold' },
  { id: 'cogs', label: '매출원가', num: true, sort: (_, c) => c.m.cogs, cell: (_, c) => mil(c.m.cogs) },
  { id: 'gp', label: '매출이익', num: true, sort: (_, c) => c.m.gp, cell: (_, c) => mil(c.m.gp) },
  { id: 'gpm', label: '이익률', num: true, sort: (_, c) => c.m.gpm, cell: (_, c) => pct(c.m.gpm), className: (_, c) => tone(c.m.gpm) },
  { id: 'inc', label: '장려금', num: true, sort: (_, c) => c.m.incentive, cell: (_, c) => mil(c.m.incentive) },
  { id: 'gen', label: '일반비', num: true, sort: (_, c) => c.m.general, cell: (_, c) => mil(c.m.general) },
  { id: 'op', label: '영업이익', num: true, sort: (_, c) => c.m.op, cell: (_, c) => mil(c.m.op), className: (_, c) => `font-semibold ${tone(c.m.op)}` },
  { id: 'opm', label: '영업이익률', num: true, sort: (_, c) => c.m.opm, cell: (_, c) => pct(c.m.opm), className: (_, c) => tone(c.m.opm) },
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

  const compare = scenario !== 'prev';
  const cols = COLS.filter((c) => compare || !c.compare);

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
    const col = COLS.find((c) => c.id === sort.id) ?? COLS[8];
    const withCtx = rows
      .filter((r) => !l1 || r.l1 === l1)
      .filter((r) => !q || [r.matnr, r.name, r.l2t, r.l3t, r.l4t].some((v) => v.toLowerCase().includes(q)))
      .map((r) => {
        const ctx: Ctx = { m: metrics(r[scenario]), p: metrics(r.prev), price: unitPrice(r[scenario]), prevPrice: unitPrice(r.prev) };
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
  }, [rows, l1, query, scenario, sort]);

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
    setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: !['matnr', 'name', 'l1', 'l2', 'l3', 'l4'].includes(id) }));
    setLimit(PAGE);
  };
  const label = (s: Scenario) => `${monthLabel(s === 'prev' ? prevYm : curYm)} ${SCENARIO_LABEL[s].split(' ')[1]}`;

  return (
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
          <span className="text-muted">제품계층 LV1</span>
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
            setLimit(PAGE);
          }}
          placeholder="제품코드·제품명·LV2~LV4 검색"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5"
        />
        <span className="ml-auto text-xs text-muted">
          {list.length.toLocaleString()}개 제품 · 금액 백만원, 단가 원/EA · 머리글을 누르면 정렬
        </span>
      </div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="dtable">
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
              <td className="sticky left-0 z-[1]">합계</td>
              <td colSpan={5} className="text-xs font-normal text-muted">
                {l1 ? l1s.find(([k]) => k === l1)?.[1].label : '전체'}
                {query && ` · "${query}"`}
              </td>
              <td className="num">-</td>
              <td className="num">-</td>
              <td className="num">{mil(total.sales)}</td>
              <td className="num">{mil(total.cogs)}</td>
              <td className="num">{mil(total.gp)}</td>
              <td className="num">{pct(total.gpm)}</td>
              <td className="num">{mil(total.incentive)}</td>
              <td className="num">{mil(total.general)}</td>
              <td className="num">{mil(total.op)}</td>
              <td className="num">{pct(total.opm)}</td>
              {compare && <td colSpan={4} className="border-l border-border" />}
            </tr>
            {list.slice(0, limit).map(({ r, ctx }) => (
              <tr key={r.matnr}>
                {cols.map((c, i) => {
                  const text = !c.num;
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
    </div>
  );
}
