'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { eok, pct, tone } from '@/lib/format';
import { closedIdx, statementOf, type Ledger, type LedgerKind, type Line, type Statement } from '@/lib/ledger';
import { dateLabel, monthLabel } from '@/lib/period';
import { clamp, CountUp, Panel, useArmed, useInView, useWidth } from './motion';

type LedgerData = Ledger & { dataDate: string | null };

const nf1 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** 표 칸: 억원 소수 1자리, 음수는 '−' */
const cell = (v: number) => {
  const r = Math.round(v / 1e7) / 10;
  return r === 0 ? '0.0' : `${r < 0 ? '−' : ''}${nf1.format(Math.abs(r))}`;
};
const won = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}원`;
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

const KIND_TAG: Record<LedgerKind, string | null> = { closed: null, provisional: '잠정', estimate: '예상' };

/** 손익 구조 차트 색: 매출조정 · 매출원가 · 판관비 */
const PART_COLOR = { adj: 'var(--viz-2)', cogs: '#8fa3bf', sga: 'var(--viz-1)' };
const PART_LABEL = { adj: '매출조정(장려금)', cogs: '매출원가', sga: '판관비' };

export default function LedgerPnl({ data }: { data: LedgerData }) {
  const closed = closedIdx(data);
  const st = data.months.map((_, i) => statementOf(data, [i]));
  const ytd = statementOf(data, closed);
  const range = closed.length ? `${monthLabel(data.months[closed[0]].ym)}~${monthLabel(data.months[closed[closed.length - 1]].ym)}` : '';
  const est = data.months.findIndex((m) => m.kind === 'estimate');
  return (
    <div className="il-stack">
      {closed.length > 0 && <Hero ytd={ytd} range={range} n={closed.length} />}
      <div className="notice-bar lp-source">
        <span className="notice-label">원천</span>
        <span>총매출·매출원가 = CO-PA 실적 · 매출조정(장려금) = 회계원장 41xx · 판관비 = 회계원장 61xx (팀별). 수기 입력값은 쓰지 않습니다.</span>
        {data.dataDate && <span className="notice-action">매출 {dateLabel(data.dataDate)} 기준</span>}
      </div>
      <StructureChart data={data} st={st} />
      <StatementTable data={data} st={st} ytd={ytd} range={range} />
      {est >= 0 && data.posted && (
        <p className="summary-footnote">
          {monthLabel(data.months[est].ym)}은 마감 전입니다. 총매출·매출원가는 월말 예상(누계 ÷ 진행일 × 월 일수, 원가는 최근 3개월 평균 단위원가), 매출조정·판관비는{' '}
          {data.basis.map(monthLabel).join('·')} 평균으로 추정했습니다. 지금까지 원장 반영분: 매출조정 {eok(data.posted.adj)}, 판관비 {eok(data.posted.sga)}.
          {data.months.some((m) => m.kind === 'provisional') && ' 잠정 = 매월 15일 전까지는 전월 결산 전표가 더 들어올 수 있습니다.'}
        </p>
      )}
      <TeamPanel data={data} closed={closed} range={range} />
    </div>
  );
}

// ── 누계 핵심 수치 ─────────────────────────────────────────

function Hero({ ytd, range, n }: { ytd: Statement; range: string; n: number }) {
  const [ref, seen] = useInView<HTMLElement>();
  const per100 = ytd.sales ? (ytd.sga / ytd.sales) * 100 : 0;
  const cards: { title: string; value: number; fmt: (v: number) => string; sub: ReactNode; tone?: string }[] = [
    {
      title: `${range} 순매출`,
      value: ytd.net,
      fmt: eok,
      sub: <>총매출 {eok(ytd.sales)} − 매출조정 {eok(ytd.adj)} ({pct(ytd.sales ? ytd.adj / ytd.sales : null)})</>,
    },
    {
      title: `${range} 매출총이익`,
      value: ytd.gp,
      fmt: eok,
      sub: <>GP율 {pct(ytd.gpm)} · 매출원가 {eok(ytd.cogs)}</>,
      tone: ytd.gp < 0 ? 'down' : 'up',
    },
    {
      title: `${range} 영업이익`,
      value: ytd.op,
      fmt: eok,
      sub: <>OP율 {pct(ytd.opm)} · 월평균 {eok(ytd.op / n)}</>,
      tone: ytd.op < 0 ? 'down' : 'up',
    },
    {
      title: '총매출 100원당 판관비',
      value: per100,
      fmt: (v) => `${v.toFixed(1)}원`,
      sub: <>판관비 {eok(ytd.sga)} · 월평균 {eok(ytd.sga / n)}</>,
    },
  ];
  return (
    <section ref={ref} className="il-hero" aria-label="SAP 실적 누계">
      {cards.map((c, i) => (
        <div key={c.title} className={`il-hero-card ${seen ? 'on' : ''}`} style={{ transitionDelay: `${i * 80}ms` }}>
          <div className="il-hero-title">{c.title}</div>
          <div className={`il-hero-value ${c.tone ?? ''}`}>
            <CountUp value={c.value} format={c.fmt} active={seen} />
          </div>
          <div className="il-hero-sub">{c.sub}</div>
        </div>
      ))}
    </section>
  );
}

// ── 총매출 100원은 어디로 갔나 ─────────────────────────────

function StructureChart({ data, st }: { data: LedgerData; st: Statement[] }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [ref, seen] = useInView<HTMLDivElement>();
  const on = useArmed(seen && width > 0);
  const [hover, setHover] = useState<number | null>(null);

  const cols = st.map((s, i) => {
    const k = s.sales > 0 ? 100 / s.sales : 0;
    return { i, adj: s.adj * k, cogs: s.cogs * k, sga: s.sga * k, op: s.op * k, ok: s.sales > 0 };
  });
  const top = Math.max(100, ...cols.map((c) => c.adj + c.cogs + c.sga));
  const yMax = Math.ceil((top * 1.1) / 20) * 20;
  const H = 320;
  const M = { l: 44, r: 14, t: 30, b: 34 };
  const iw = Math.max(width - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  const step = iw / Math.max(cols.length, 1);
  const bw = Math.min(46, step * 0.58);
  const Y = (v: number) => M.t + (1 - v / yMax) * ih;
  const ticks = Array.from({ length: Math.floor(yMax / 20) + 1 }, (_, i) => i * 20);
  const hc = hover != null ? cols[hover] : null;

  return (
    <Panel
      title="총매출 100원은 어디로 갔나"
      desc="월별로 총매출 100원을 매출조정(장려금)·매출원가·판관비가 얼마씩 가져갔는지 쌓았습니다. 막대가 100원 선을 넘은 만큼이 영업손실, 못 미친 만큼이 영업이익입니다."
      tools={
        <div className="lp-legend">
          {(Object.keys(PART_LABEL) as (keyof typeof PART_LABEL)[]).map((k) => (
            <span key={k}>
              <i style={{ background: PART_COLOR[k] }} />
              {PART_LABEL[k]}
            </span>
          ))}
        </div>
      }
    >
      <div ref={box} className="lp-chart">
        <div ref={ref} style={{ position: 'relative' }}>
          {width > 0 && (
            <svg width={width} height={H} role="img" aria-label="월별 총매출 100원당 손익 구조">
              <defs>
                <pattern id="lp-loss" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--viz-down)" fillOpacity=".12" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--viz-down)" strokeWidth="2" strokeOpacity=".55" />
                </pattern>
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={M.l} x2={M.l + iw} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={t === 0 ? 1 : 0.7} />
                  <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className="il-tick">{t}</text>
                </g>
              ))}
              <text x={M.l - 36} y={M.t - 14} className="il-tick il-axis-title">원</text>
              {cols.map((c) => {
                const m = data.months[c.i];
                const cx = M.l + step * c.i + step / 2;
                const x = cx - bw / 2;
                const parts: [keyof typeof PART_COLOR, number, number][] = [];
                let acc = 0;
                for (const k of ['cogs', 'adj', 'sga'] as const) {
                  parts.push([k, acc, acc + c[k]]);
                  acc += c[k];
                }
                const loss = acc > 100;
                const delay = `${c.i * 60}ms`;
                return (
                  <g key={m.ym} className={`lp-col ${hover === c.i ? 'is-hover' : ''}`} opacity={m.kind === 'estimate' ? 0.6 : 1}>
                    {c.ok && (
                      <g className={`lp-stack ${on ? 'on' : ''}`} style={{ transformOrigin: `${cx}px ${Y(0)}px`, transitionDelay: delay }}>
                        {parts.map(([k, a, b]) => (
                          <rect key={k} x={x} width={bw} y={Y(Math.max(a, b))} height={Math.max(Math.abs(Y(a) - Y(b)), 0)} fill={PART_COLOR[k]} />
                        ))}
                        {loss && <rect x={x} width={bw} y={Y(acc)} height={Y(100) - Y(acc)} fill="url(#lp-loss)" />}
                      </g>
                    )}
                    {c.ok && (
                      <text x={cx} y={Y(Math.max(acc, 100)) - 8} textAnchor="middle" className={`lp-op ${on ? 'on' : ''} ${c.op < 0 ? 'neg' : 'pos'}`} style={{ transitionDelay: `${c.i * 60 + 400}ms` }}>
                        {c.op < 0 ? '−' : '+'}{Math.abs(c.op).toFixed(0)}
                      </text>
                    )}
                    <text x={cx} y={H - 14} textAnchor="middle" className="il-tick">{monthLabel(m.ym)}</text>
                    {KIND_TAG[m.kind] && <text x={cx} y={H - 1} textAnchor="middle" className="il-tick lp-kind">{KIND_TAG[m.kind]}</text>}
                    <rect x={M.l + step * c.i} y={M.t} width={step} height={ih} fill="transparent" onPointerEnter={() => setHover(c.i)} onPointerLeave={() => setHover(null)} />
                  </g>
                );
              })}
              <line x1={M.l} x2={M.l + iw} y1={Y(100)} y2={Y(100)} className="lp-100" />
              <text x={M.l + iw} y={Y(100) - 6} textAnchor="end" className="il-ann">총매출 100원</text>
            </svg>
          )}
          {hc && hc.ok && (
            <div className="il-tip lp-tip" style={{ left: clamp(M.l + step * hc.i + step / 2, 110, width - 110), top: M.t }}>
              {monthLabel(data.months[hc.i].ym)} {KIND_TAG[data.months[hc.i].kind] ?? '실적'} · 총매출 100원당
              <span>매출원가 {won(hc.cogs)} · 매출조정 {won(hc.adj)} · 판관비 {won(hc.sga)}</span>
              <b className={hc.op < 0 ? 'lp-tip-neg' : ''}>영업{hc.op < 0 ? '손실' : '이익'} {won(Math.abs(hc.op))}</b>
            </div>
          )}
        </div>
      </div>
      <div className="panel-footer il-foot">
        <span>막대 위 숫자 = 총매출 100원당 영업이익(원). 이 차트만 총매출 기준이고, 표의 GP율·OP율은 앱 공통대로 순매출 기준입니다.</span>
      </div>
    </Panel>
  );
}

// ── 손익계산서 표 ──────────────────────────────────────────

interface RowDef {
  key: string;
  label: string;
  values: number[];
  total: number;
  style?: 'key' | 'rate' | 'cost';
  depth?: number;
  children?: RowDef[];
  /** 이익 행: 음수를 빨갛게 */
  profit?: boolean;
  rate?: boolean;
}

const lineRow = (l: Line, closed: number[], depth: number, children?: RowDef[]): RowDef => ({
  key: l.key,
  label: l.label,
  values: l.values,
  total: sum(closed.map((i) => l.values[i])),
  depth,
  style: 'cost',
  children,
});

function StatementTable({ data, st, ytd, range }: { data: LedgerData; st: Statement[]; ytd: Statement; range: string }) {
  const closed = closedIdx(data);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['sga']));
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const of = (f: (s: Statement) => number) => st.map(f);
  const rateRow = (key: string, label: string, f: (s: Statement) => number | null): RowDef => ({
    key,
    label,
    values: st.map((s) => f(s) ?? NaN),
    total: f(ytd) ?? NaN,
    style: 'rate',
    rate: true,
    profit: true,
  });
  const rows: RowDef[] = [
    { key: 'sales', label: '총매출', values: of((s) => s.sales), total: ytd.sales },
    {
      key: 'adj',
      label: '매출조정 (장려금 등)',
      values: of((s) => s.adj),
      total: ytd.adj,
      style: 'cost',
      children: data.adj.map((l) => lineRow(l, closed, 1)),
    },
    { key: 'net', label: '순매출', values: of((s) => s.net), total: ytd.net, style: 'key' },
    { key: 'cogs', label: '매출원가', values: of((s) => s.cogs), total: ytd.cogs, style: 'cost' },
    { key: 'gp', label: '매출총이익', values: of((s) => s.gp), total: ytd.gp, style: 'key', profit: true },
    rateRow('gpm', 'GP율', (s) => s.gpm),
    {
      key: 'sga',
      label: '판관비',
      values: of((s) => s.sga),
      total: ytd.sga,
      style: 'cost',
      children: data.sga.map((g) => lineRow(g, closed, 1, g.items.map((it) => lineRow({ ...it, key: `${g.key}:${it.key}` }, closed, 2)))),
    },
    { key: 'op', label: '영업이익', values: of((s) => s.op), total: ytd.op, style: 'key', profit: true },
    rateRow('opm', 'OP율', (s) => s.opm),
  ];

  const fmt = (r: RowDef, v: number) => (r.rate ? (Number.isFinite(v) ? pct(v) : '-') : cell(v));
  const render = (r: RowDef): ReactNode => {
    const expandable = !!r.children?.length;
    const isOpen = open.has(r.key);
    return (
      <Fragment key={r.key}>
        <tr className={`lp-row lp-${r.style ?? 'plain'} lp-d${r.depth ?? 0}`}>
          <th scope="row">
            {expandable ? (
              <button type="button" className="lp-toggle" aria-expanded={isOpen} onClick={() => toggle(r.key)}>
                <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                {r.label}
              </button>
            ) : (
              <span className="lp-label">{r.label}</span>
            )}
          </th>
          {r.values.map((v, i) => (
            <td key={data.months[i].ym} className={`num ${data.months[i].kind === 'estimate' ? 'lp-est' : ''} ${r.profit ? tone(v) : ''}`}>
              {fmt(r, v)}
            </td>
          ))}
          <td className={`num lp-total ${r.profit ? tone(r.total) : ''}`}>{fmt(r, r.total)}</td>
        </tr>
        {expandable && isOpen && r.children!.map(render)}
      </Fragment>
    );
  };

  return (
    <Panel
      title="실적 손익계산서"
      desc="SAP 실적만으로 계산한 월별 손익입니다. 매출조정·판관비를 누르면 계정과 비용 분류가 펼쳐집니다."
      tools={<span className="unit-label">단위: 억원</span>}
    >
      <div className="lp-scroll">
        <table className="dtable lp-table">
          <thead>
            <tr>
              <th scope="col">항목</th>
              {data.months.map((m) => (
                <th key={m.ym} scope="col" className={`num ${m.kind === 'estimate' ? 'lp-est' : ''}`}>
                  {monthLabel(m.ym)}
                  {KIND_TAG[m.kind] && <small>{KIND_TAG[m.kind]}</small>}
                </th>
              ))}
              <th scope="col" className="num lp-total">
                누계<small>{range} 실적</small>
              </th>
            </tr>
          </thead>
          <tbody>{rows.map(render)}</tbody>
        </table>
      </div>
    </Panel>
  );
}

// ── 판관비 팀별 ────────────────────────────────────────────

const TEAMS = 15;

function Spark({ values, closed }: { values: number[]; closed: number[] }) {
  const v = closed.map((i) => values[i]);
  if (v.length < 2) return null;
  const lo = Math.min(0, ...v);
  const hi = Math.max(...v) || 1;
  const W = 96;
  const Hh = 22;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(Hh - ((x - lo) / (hi - lo || 1)) * Hh).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={Hh + 2} className="lp-spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--viz-1)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function TeamPanel({ data, closed, range }: { data: LedgerData; closed: number[]; range: string }) {
  const [all, setAll] = useState(false);
  const teams = data.teams.map((t) => ({ ...t, total: sum(closed.map((i) => t.values[i])) })).sort((a, b) => b.total - a.total);
  const grand = sum(teams.map((t) => t.total));
  const max = Math.max(...teams.map((t) => Math.abs(t.total)), 1);
  const shown = all ? teams : teams.slice(0, TEAMS);
  const n = closed.length || 1;
  return (
    <Panel
      title="판관비 팀별"
      desc={`${range} 판관비를 코스트센터(팀) 기준으로 나눴습니다. 추이는 월별 실적입니다.`}
      tools={<span className="unit-label">단위: 억원</span>}
    >
      <div className="lp-scroll">
        <table className="dtable lp-teams">
          <thead>
            <tr>
              <th scope="col">팀</th>
              <th scope="col">월별 추이</th>
              <th scope="col" className="num">누계</th>
              <th scope="col" className="num">월평균</th>
              <th scope="col">비중</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.key}>
                <td className="lp-team" title={t.key !== '-' ? `코스트센터 ${t.key}` : undefined}>{t.label}</td>
                <td><Spark values={t.values} closed={closed} /></td>
                <td className="num">{cell(t.total)}</td>
                <td className="num">{cell(t.total / n)}</td>
                <td>
                  <span className="lp-share">
                    <span style={{ width: `${(Math.abs(t.total) / max) * 100}%` }} />
                    <em>{pct(grand ? t.total / grand : null, 0)}</em>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {teams.length > TEAMS && (
        <div className="panel-footer">
          <span>전체 {teams.length}개 팀 · 판관비 누계 {eok(grand)}</span>
          <button type="button" className="lp-more" onClick={() => setAll((v) => !v)}>{all ? '상위만 보기' : `전체 ${teams.length}개 보기`}</button>
        </div>
      )}
    </Panel>
  );
}
