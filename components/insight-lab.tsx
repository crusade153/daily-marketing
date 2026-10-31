'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { eok, pct, ppt, signedEok, tone } from '@/lib/format';
import {
  FACTOR_HINT,
  FACTOR_LABEL,
  headlineFactor,
  MOMENTUM_AXES,
  momentumKind,
  type BridgeFactor,
  type Contributor,
  type InsightData,
  type InsightPair,
  type MarginBasis,
  type MomentumAxis,
  type MomentumKind,
  type MomentumPoint,
  type ProfitMetric,
  type Whale,
} from '@/lib/insight';
import { AXIS_LABEL } from '@/lib/pnl';
import { dateLabel } from '@/lib/period';
import { clamp, CountUp, easeOut, Panel, reducedMotion, Segmented, useArmed, useInView, useWidth } from './motion';

const METRIC_LABEL: Record<ProfitMetric, string> = { op: '영업이익', gp: '매출총이익' };

const KIND_LABEL: Record<MomentumKind, string> = {
  good: '좋은 성장',
  hollow: '속 빈 성장',
  defend: '수익성 방어',
  decline: '동반 하락',
};
const KIND_HINT: Record<MomentumKind, string> = {
  good: '매출 ↑ · GP율 ↑',
  hollow: '매출 ↑ · GP율 ↓',
  defend: '매출 ↓ · GP율 ↑',
  decline: '매출 ↓ · GP율 ↓',
};
const KIND_COLOR: Record<MomentumKind, string> = {
  good: 'var(--pos)',
  hollow: 'var(--viz-2)',
  defend: 'var(--viz-1)',
  decline: 'var(--viz-down)',
};

/** 성장 품질 맵의 이익률 기준 이름 */
const BASIS: Record<MarginBasis, { short: string; rate: string; profit: string }> = {
  pre: { short: '장려금 전', rate: '매출이익률', profit: '매출이익' },
  net: { short: '장려금 반영', rate: 'GP율', profit: '매출총이익' },
};

const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** 0 기준 발산 막대 목록 (상위 기여 제품·채널) */
function ContribList({ items, empty = '해당 없음' }: { items: Contributor[]; empty?: string }) {
  if (!items.length) return <p className="il-empty">{empty}</p>;
  const max = Math.max(...items.map((c) => Math.abs(c.value))) || 1;
  return (
    <ol className="il-contrib">
      {items.map((c, i) => (
        <li key={`${c.label}-${i}`}>
          <span className="il-contrib-name" title={c.label}>{c.label}</span>
          <span className="il-contrib-track" aria-hidden="true">
            <span
              style={{
                width: `${(Math.abs(c.value) / max) * 50}%`,
                left: c.value >= 0 ? '50%' : undefined,
                right: c.value < 0 ? '50%' : undefined,
                background: c.value >= 0 ? 'var(--viz-1)' : 'var(--viz-down)',
              }}
            />
          </span>
          <span className={`num ${tone(c.value)}`}>{signedEok(c.value)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── 메인 ───────────────────────────────────────────────────

export default function InsightLab({ data }: { data: InsightData }) {
  const [pairId, setPairId] = useState(data.pairs[0]?.id ?? '');
  const [metric, setMetric] = useState<ProfitMetric>(data.opReady ? 'op' : 'gp');
  const pair = data.pairs.find((p) => p.id === pairId) ?? data.pairs[0];
  if (!pair) return <p className="il-empty card">비교할 마감월 실적이 없습니다.</p>;
  return (
    <div className="il-stack">
      <Hero data={data} metric={metric} />
      <div className="il-toolbar">
        <div className="il-tool">
          <span>비교 기간</span>
          <Segmented
            label="비교 기간"
            value={pair.id}
            options={data.pairs.map((p) => ({ id: p.id, label: `${p.baseLabel} → ${p.curLabel}` }))}
            onChange={setPairId}
          />
        </div>
        <div className="il-tool">
          <span>이익 기준</span>
          <Segmented label="이익 기준" value={metric} options={(['op', 'gp'] as const).map((id) => ({ id, label: METRIC_LABEL[id] }))} onChange={setMetric} />
        </div>
        {data.dataDate && <span className="il-asof">데이터 {dateLabel(data.dataDate)} 기준</span>}
      </div>
      {pair.coverage.length > 0 && (
        <div className="notice-bar">
          <span className="notice-label">입력 확인</span>
          <span>장려금·일반비 입력 미완료: {pair.coverage.join(' · ')} — 장려금·일반비 요인에는 입력 차이가 섞여 있습니다.</span>
        </div>
      )}
      <BridgePanel pair={pair} />
      <WhalePanel data={data} metric={metric} />
      <MomentumPanel pair={pair} />
    </div>
  );
}

// ── 히어로: 핵심 수치 카운트업 ─────────────────────────────

function Hero({ data, metric }: { data: InsightData; metric: ProfitMetric }) {
  const [ref, seen] = useInView<HTMLElement>();
  const pair = data.pairs[0];
  const w = data.whales[0][metric];
  const b = pair.bridge;
  const complete = pair.coverage.length === 0;
  const big = headlineFactor(b, complete) ?? b.steps[0];
  const loss = w.peak - w.total;
  const cards: { title: string; value: number; fmt: (v: number) => string; sub: ReactNode; tone?: string }[] = [
    {
      title: `${pair.curLabel} ${METRIC_LABEL[metric]}`,
      value: metric === 'op' ? b.cur : w.total,
      fmt: eok,
      sub: metric === 'op' ? <>{pair.baseLabel} 대비 <b className="il-hero-delta">{signedEok(b.cur - b.base)}</b></> : <>제품 {w.n.toLocaleString()}개 합계</>,
    },
    {
      title: '가장 큰 변동 요인',
      value: big.value,
      fmt: signedEok,
      sub: <>{FACTOR_LABEL[big.key]} · {pair.baseLabel} → {pair.curLabel}{!complete && ' (장려금·일반비 제외)'}</>,
      tone: big.value >= 0 ? 'up' : 'down',
    },
    {
      title: `흑자 제품 ${w.winners.toLocaleString()}개가 번 이익`,
      value: w.peak,
      fmt: eok,
      sub: w.total > 0 ? <>최종 {METRIC_LABEL[metric]}의 {pct(share(w.peak, w.total), 0)} · 전체 제품의 {pct(share(w.winners, w.n), 0)}</> : <>전체 제품의 {pct(share(w.winners, w.n), 0)} · 최종 {eok(w.total)}</>,
    },
    {
      title: `적자 제품 ${w.losers.toLocaleString()}개가 깎은 이익`,
      value: -loss,
      fmt: eok,
      sub: w.total > 0 ? <>적자만 손익분기로 맞춰도 {pct(share(loss, w.total), 0)} 개선</> : w.peak > 0 ? <>적자만 손익분기로 맞춰도 {eok(w.peak)} 흑자 전환</> : <>흑자 제품이 없습니다</>,
      tone: 'down',
    },
  ];
  return (
    <section ref={ref} className="il-hero" aria-label="손익 인사이트 핵심 수치">
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

// ── ① 영업이익 브리지 ──────────────────────────────────────

interface WfRow {
  key: string;
  label: string;
  from: number;
  to: number;
  total?: boolean;
  factor?: BridgeFactor;
}

function BridgePanel({ pair }: { pair: InsightPair }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const b = pair.bridge;
  const biggest = headlineFactor(b, pair.coverage.length === 0)?.key ?? 'price';
  const [picked, setPicked] = useState<{ pair: string; key: BridgeFactor } | null>(null);
  // 기간을 바꾸면 그 기간의 가장 큰 요인으로 돌아간다
  const selected = picked && picked.pair === pair.id ? picked.key : biggest;
  const step = b.steps.find((s) => s.key === selected) ?? b.steps[0];

  const rows: WfRow[] = [{ key: 'base', label: `${pair.baseLabel} 영업이익`, from: 0, to: b.base, total: true }];
  let acc = b.base;
  for (const s of b.steps) {
    rows.push({ key: s.key, label: FACTOR_LABEL[s.key], from: acc, to: acc + s.value, factor: s.key });
    acc += s.value;
  }
  rows.push({ key: 'cur', label: `${pair.curLabel} 영업이익`, from: 0, to: b.cur, total: true });

  return (
    <Panel
      title="① 영업이익 브리지"
      desc={`${pair.baseLabel} → ${pair.curLabel} 영업이익 차이 ${signedEok(b.cur - b.base)}를 가격·물량·믹스·원가·비용으로 나눴습니다. 요인을 누르면 기여 제품·채널이 나옵니다.`}
      tools={<span className="unit-label">단위: 억원</span>}
    >
      <div ref={ref} className="il-bridge">
        <Waterfall key={pair.id} rows={rows} active={seen} selected={selected} onPick={(key) => setPicked({ pair: pair.id, key })} />
        <aside className="il-detail" aria-live="polite">
          <div className="il-detail-head">
            <span>{FACTOR_LABEL[step.key]}</span>
            <b className={tone(step.value)}>{signedEok(step.value)}</b>
          </div>
          <p className="il-detail-hint">{FACTOR_HINT[step.key]}</p>
          <div className="il-detail-sub">{step.key === 'incentive' || step.key === 'general' ? '채널별 기여' : '제품별 기여'} 상위</div>
          <ContribList items={step.top} />
        </aside>
      </div>
      <div className="panel-footer il-foot">
        <span>
          단가 비교 가능 매출 비중 {pct(b.matchedShare, 0)}
          {pair.fcst && ' · 진행 중인 달의 매출원가는 최근 3개월 평균 단위원가 기준이라, 단위원가 요인은 그 평균과 기준월 실제원가의 차이입니다'}
        </span>
        <span>요인 합계 = 영업이익 차이 (반올림 오차 제외)</span>
      </div>
    </Panel>
  );
}

function Waterfall({ rows, active, selected, onPick }: { rows: WfRow[]; active: boolean; selected: BridgeFactor; onPick: (k: BridgeFactor) => void }) {
  const on = useArmed(active);
  const vals = rows.flatMap((r) => [r.from, r.to]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.04 || 1;
  const x = (v: number) => ((v - lo + pad) / (hi - lo + pad * 2)) * 100;
  return (
    <div className="il-wf" role="group" aria-label="영업이익 브리지">
      {rows.map((r, i) => {
        const d = r.to - r.from;
        const left = x(Math.min(r.from, r.to));
        const width = Math.max(x(Math.max(r.from, r.to)) - left, 0.3);
        const color = r.total ? 'var(--viz-total)' : d >= 0 ? 'var(--viz-1)' : 'var(--viz-down)';
        const content = (
          <>
            <span className="il-wf-label">{r.label}</span>
            <span className="il-wf-track">
              <span className="il-wf-zero" style={{ left: `${x(0)}%` }} />
              <span
                className={`il-wf-bar ${on ? 'on' : ''}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: color,
                  transformOrigin: r.total || d >= 0 ? 'left' : 'right',
                  transitionDelay: `${i * 70}ms`,
                }}
              />
              {i < rows.length - 1 && <span className="il-wf-link" style={{ left: `${x(r.to)}%` }} />}
            </span>
            <span className={`il-wf-value num ${r.total ? '' : tone(d)}`}>{r.total ? eok(r.to) : signedEok(d)}</span>
          </>
        );
        return r.factor ? (
          <button
            key={r.key}
            type="button"
            className={`il-wf-row ${selected === r.factor ? 'is-selected' : ''}`}
            aria-pressed={selected === r.factor}
            onClick={() => onPick(r.factor!)}
          >
            {content}
          </button>
        ) : (
          <div key={r.key} className="il-wf-row is-total">
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ── ② 이익 고래곡선 ────────────────────────────────────────

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

const eokTick = (v: number) => `${(v / 1e8).toFixed(Math.abs(v) < 1e9 && v !== 0 ? 1 : 0)}`;

function WhalePanel({ data, metric }: { data: InsightData; metric: ProfitMetric }) {
  const [id, setId] = useState(data.whales[0].id);
  const wh = data.whales.find((w) => w.id === id) ?? data.whales[0];
  const w = wh[metric];
  const loss = w.peak - w.total;
  return (
    <Panel
      title="② 이익 고래곡선"
      desc={`제품을 ${METRIC_LABEL[metric]} 큰 순으로 쌓은 누적 곡선입니다. 정점까지가 흑자 제품, 정점 이후 내려가는 꼬리가 적자 제품이 깎은 이익입니다.`}
      tools={<Segmented label="기간" value={wh.id} options={data.whales.map((x) => ({ id: x.id, label: x.label }))} onChange={setId} />}
    >
      <div className="il-whale">
        <WhaleChart key={`${wh.id}-${metric}`} w={w} metric={metric} />
        <aside className="il-whale-side">
          <p className="il-insight">
            흑자 제품 <b>{w.winners.toLocaleString()}개</b>가 <b>{eok(w.peak)}</b>을 벌고, 적자 제품 <b>{w.losers.toLocaleString()}개</b>가{' '}
            <b className="text-neg">{eok(loss)}</b>을 깎아 최종 <b>{eok(w.total)}</b>입니다.
            {loss > 0 &&
              (w.total > 0 ? (
                <> 적자 제품을 손익분기까지만 끌어올려도 {METRIC_LABEL[metric]}이 <b className="text-pos">{pct(loss / w.total, 0)}</b> 늘어납니다.</>
              ) : w.peak > 0 ? (
                <> 적자 제품을 손익분기까지만 끌어올려도 <b className="text-pos">{eok(w.peak)} 흑자</b>로 돌아섭니다.</>
              ) : null)}
          </p>
          <div className="il-side-title">이익 상위 제품</div>
          <ContribList items={w.best} />
          <div className="il-side-title">손실 상위 제품</div>
          <ContribList items={w.worst} empty="적자 제품이 없습니다" />
        </aside>
      </div>
      <div className="panel-footer il-foot">
        <span>제품 단위 합계 (채널 합산). 매출이 없는 채널에 입력된 비용은 제품에 붙지 않아 빠집니다.</span>
        <span>상위 20% 제품 누적 {eok(w.top20)}{w.total > 0 && ` = ${METRIC_LABEL[metric]}의 ${pct(w.top20 / w.total, 0)}`}</span>
      </div>
    </Panel>
  );
}

function WhaleChart({ w, metric }: { w: Whale; metric: ProfitMetric }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [ref, seen] = useInView<HTMLDivElement>();
  const on = useArmed(seen && width > 0);
  const [hover, setHover] = useState<number | null>(null);

  const H = 310;
  const M = { l: 48, r: 18, t: 26, b: 36 };
  const iw = Math.max(width - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  const ys = w.points.map((p) => p[1]);
  const lo = Math.min(0, ...ys) * 1.06;
  const hi = Math.max(0, ...ys) * 1.14 || Math.abs(lo) * 0.1 || 1;
  const X = (v: number) => M.l + v * iw;
  const Y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * ih;
  const line = w.points.map(([px, py], i) => `${i ? 'L' : 'M'}${X(px).toFixed(1)},${Y(py).toFixed(1)}`).join('');
  const area = `${line}L${X(1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  const peakX = w.n ? w.winners / w.n : 0;
  const yTicks = niceTicks(lo, hi / 1.05);
  const loss = w.peak - w.total;
  const hp = hover != null ? w.points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = clamp((e.clientX - r.left) / r.width, 0, 1);
    let best = 0;
    for (let i = 1; i < w.points.length; i++) if (Math.abs(w.points[i][0] - v) < Math.abs(w.points[best][0] - v)) best = i;
    setHover(best);
  };

  // 정점 말풍선은 곡선 위, 오른쪽 끝을 넘으면 왼쪽으로 붙인다
  const peakLabelRight = X(peakX) + 190 > M.l + iw;
  return (
    <div ref={box} className="il-whale-chart">
      <div ref={ref} style={{ position: 'relative' }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`이익 고래곡선: 정점 ${eok(w.peak)}, 최종 ${eok(w.total)}, 적자 제품 ${w.losers}개`}>
            <defs>
              <linearGradient id="il-whale-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--viz-1)" stopOpacity=".28" />
                <stop offset="1" stopColor="var(--viz-1)" stopOpacity=".02" />
              </linearGradient>
            </defs>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={M.l + iw} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={t === 0 ? 1 : 0.7} />
                <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className="il-tick">{eokTick(t)}</text>
              </g>
            ))}
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <text key={t} x={X(t)} y={H - 14} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} className="il-tick">{Math.round(t * 100)}%</text>
            ))}
            <text x={M.l + iw / 2} y={H - 1} textAnchor="middle" className="il-tick il-axis-title">이익 큰 순 제품 누적 비중</text>
            <text x={M.l - 40} y={M.t - 12} className="il-tick il-axis-title">누적 {METRIC_LABEL[metric]} (억)</text>

            {/* 적자 꼬리: 정점 이후 구간 */}
            <rect x={X(peakX)} y={M.t} width={Math.max(X(1) - X(peakX), 0)} height={ih} className={`il-tail ${on ? 'on' : ''}`} />
            <path d={area} fill="url(#il-whale-fill)" className={`il-area ${on ? 'on' : ''}`} />
            <path d={line} pathLength={1} className={`il-curve ${on ? 'on' : ''}`} />

            {/* 정점 → 최종 손실 표시 */}
            <line x1={X(peakX)} x2={X(1)} y1={Y(w.peak)} y2={Y(w.peak)} className={`il-peak-line ${on ? 'on' : ''}`} />
            {loss > 0 && (
              <g className={`il-late ${on ? 'on' : ''}`}>
                <line x1={X(1) - 6} x2={X(1) - 6} y1={Y(w.peak)} y2={Y(w.total)} stroke="var(--viz-down)" strokeWidth={2} />
                <text x={X(1) - 12} y={(Y(w.peak) + Y(w.total)) / 2 + 4} textAnchor="end" className="il-ann il-ann-neg">−{eok(loss)} · 적자 {w.losers}개</text>
                <circle cx={X(1)} cy={Y(w.total)} r={4} fill="var(--viz-total)" />
                <text x={X(1) - 8} y={Y(w.total) + (Y(w.total) > M.t + ih - 20 ? -10 : 18)} textAnchor="end" className="il-ann">최종 {eok(w.total)}</text>
              </g>
            )}
            {w.winners > 0 && (
              <g className={`il-late ${on ? 'on' : ''}`}>
                <circle cx={X(peakX)} cy={Y(w.peak)} r={5} fill="var(--viz-1)" />
                <circle cx={X(peakX)} cy={Y(w.peak)} r={5} className="il-pulse" />
                <text x={X(peakX) + (peakLabelRight ? -10 : 10)} y={Y(w.peak) - 12} textAnchor={peakLabelRight ? 'end' : 'start'} className="il-ann il-ann-strong">
                  정점 {eok(w.peak)} · 흑자 {w.winners}개 ({pct(peakX, 0)})
                </text>
              </g>
            )}

            {hp && (
              <g pointerEvents="none">
                <line x1={X(hp[0])} x2={X(hp[0])} y1={M.t} y2={M.t + ih} stroke="var(--viz-axis)" strokeDasharray="3 3" />
                <circle cx={X(hp[0])} cy={Y(hp[1])} r={4} fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />
              </g>
            )}
            <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hp && (
          <div className="il-tip" style={{ left: clamp(X(hp[0]), 90, width - 90), top: Math.max(Y(hp[1]) - 58, 0) }}>
            상위 {Math.round(hp[0] * w.n).toLocaleString()}개 제품 ({pct(hp[0], 0)})
            <b>누적 {eok(hp[1])}</b>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ③ 성장 품질 맵 ─────────────────────────────────────────

const MAX_POINTS = 16;
const LABELS = 8;

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** k;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.length > 7 ? out.filter((_, i) => i % 2 === 0) : out;
}

const salesTick = (v: number) => (v >= 1e8 ? `${Math.round(v / 1e8).toLocaleString()}억` : `${(v / 1e8).toFixed(v >= 1e7 ? 1 : 2)}억`);

function MomentumPanel({ pair }: { pair: InsightPair }) {
  const [axis, setAxis] = useState<MomentumAxis>('category');
  // 장려금 입력이 덜 된 비교에서는 장려금 전 이익률이 기본 (입력 차이가 이익률 변화로 보이지 않게)
  const [chosen, setChosen] = useState<{ pair: string; basis: MarginBasis } | null>(null);
  const basis: MarginBasis = chosen && chosen.pair === pair.id ? chosen.basis : pair.coverage.length ? 'pre' : 'net';
  const names = BASIS[basis];
  const all = pair.momentum[axis][basis];
  const points = all.slice(0, MAX_POINTS);
  const hollow = points.filter((p) => momentumKind(p) === 'hollow').sort((a, b) => a.marginEffect - b.marginEffect)[0];
  const defaultKey = (hollow ?? points[0])?.key ?? null;
  const [picked, setPicked] = useState<{ ctx: string; key: string } | null>(null);
  const ctx = `${pair.id}-${axis}-${basis}`;
  const selKey = picked && picked.ctx === ctx ? picked.key : defaultKey;
  const sel = points.find((p) => p.key === selKey) ?? null;
  const leak = [...all].filter((p) => p.marginEffect < 0).sort((a, b) => a.marginEffect - b.marginEffect).slice(0, 5);
  const counts = all.reduce((m, p) => m.set(momentumKind(p), (m.get(momentumKind(p)) ?? 0) + 1), new Map<MomentumKind, number>());

  return (
    <Panel
      title="③ 성장 품질 맵"
      desc={`${pair.baseLabel}(빈 원) → ${pair.curLabel}(채운 원) 이동 궤적. 오른쪽은 매출 증가, 위쪽은 ${names.rate} 개선입니다. 원 크기 = ${pair.curLabel} 매출.`}
      tools={
        <div className="il-tools">
          <Segmented label="묶음 기준" value={axis} options={MOMENTUM_AXES.map((a) => ({ id: a, label: AXIS_LABEL[a] }))} onChange={setAxis} />
          <Segmented
            label="이익률 기준"
            value={basis}
            options={(['pre', 'net'] as const).map((id) => ({ id, label: BASIS[id].short }))}
            onChange={(v) => setChosen({ pair: pair.id, basis: v })}
          />
        </div>
      }
    >
      <div className="il-legend">
        {(Object.keys(KIND_LABEL) as MomentumKind[]).map((k) => (
          <span key={k}>
            <i style={{ background: KIND_COLOR[k] }} />
            {KIND_LABEL[k]} <small>{KIND_HINT[k].replace('GP율', names.rate)} · {counts.get(k) ?? 0}</small>
          </span>
        ))}
      </div>
      <div className="il-momentum">
        {points.length ? (
          <MomentumChart key={ctx} points={points} rateName={names.rate} selKey={selKey} onPick={(key) => setPicked({ ctx, key })} />
        ) : (
          <p className="il-empty">양쪽 달에 순매출이 있는 묶음이 없습니다.</p>
        )}
        <aside className="il-detail">
          {sel ? <MomentumDetail p={sel} pair={pair} basis={basis} /> : <p className="il-empty">원을 누르면 상세가 나옵니다.</p>}
          <div className="il-side-title">{names.rate} 하락으로 놓친 이익 (마진효과 하위)</div>
          <ContribList items={leak.map((p) => ({ label: p.label, value: p.marginEffect }))} empty={`${names.rate}이 떨어진 묶음이 없습니다`} />
        </aside>
      </div>
      <div className="panel-footer il-foot">
        <span>
          {basis === 'pre'
            ? `매출이익 = 총매출 − 매출원가 (장려금 차감 전). 이익 변화 = 매출효과(총매출 차이 × ${pair.baseLabel} 이익률) + 마진효과(${pair.curLabel} 총매출 × 이익률 차이).`
            : `GP 변화 = 매출효과(순매출 차이 × ${pair.baseLabel} GP율) + 마진효과(${pair.curLabel} 순매출 × GP율 차이).`}{' '}
          매출 상위 {MAX_POINTS}개 묶음 표시.
        </span>
      </div>
    </Panel>
  );
}

function MomentumDetail({ p, pair, basis }: { p: MomentumPoint; pair: InsightPair; basis: MarginBasis }) {
  const names = BASIS[basis];
  const kind = momentumKind(p);
  const max = Math.max(Math.abs(p.salesEffect), Math.abs(p.marginEffect)) || 1;
  const bar = (v: number) => (
    <span className="il-contrib-track" aria-hidden="true">
      <span style={{ width: `${(Math.abs(v) / max) * 50}%`, left: v >= 0 ? '50%' : undefined, right: v < 0 ? '50%' : undefined, background: v >= 0 ? 'var(--viz-1)' : 'var(--viz-down)' }} />
    </span>
  );
  return (
    <div className="il-mdetail">
      <div className="il-detail-head">
        <span title={p.label}>{p.label}</span>
        <em style={{ color: KIND_COLOR[kind], borderColor: KIND_COLOR[kind] }}>{KIND_LABEL[kind]}</em>
      </div>
      <dl>
        <div>
          <dt>총매출</dt>
          <dd className="num">{eok(p.s0)} → <b>{eok(p.s1)}</b> <span className={tone(p.s1 - p.s0)}>({pct(share(p.s1 - p.s0, p.s0))})</span></dd>
        </div>
        <div>
          <dt>{names.rate}</dt>
          <dd className="num">{pct(p.m0)} → <b>{pct(p.m1)}</b> <span className={tone(p.m1 - p.m0)}>({ppt(p.m1, p.m0)})</span></dd>
        </div>
        <div>
          <dt>{names.profit}</dt>
          <dd className="num">{eok(p.gp0)} → <b>{eok(p.gp1)}</b> <span className={tone(p.gp1 - p.gp0)}>({signedEok(p.gp1 - p.gp0)})</span></dd>
        </div>
      </dl>
      <ol className="il-contrib">
        <li>
          <span className="il-contrib-name">매출효과</span>
          {bar(p.salesEffect)}
          <span className={`num ${tone(p.salesEffect)}`}>{signedEok(p.salesEffect)}</span>
        </li>
        <li>
          <span className="il-contrib-name">마진효과</span>
          {bar(p.marginEffect)}
          <span className={`num ${tone(p.marginEffect)}`}>{signedEok(p.marginEffect)}</span>
        </li>
      </ol>
      <p className="il-detail-hint">{pair.baseLabel} → {pair.curLabel}</p>
    </div>
  );
}

function MomentumChart({ points, rateName, selKey, onPick }: { points: MomentumPoint[]; rateName: string; selKey: string | null; onPick: (k: string) => void }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0);
  const DUR = 1100;
  const GAP = 45;

  useEffect(() => {
    if (!seen) return;
    const total = reducedMotion() ? 0 : DUR + points.length * GAP;
    const t0 = performance.now();
    let raf = 0;
    const f = (t: number) => {
      const e = total ? t - t0 : Infinity;
      setElapsed(e);
      if (e < total) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [seen, run, points.length]);

  const H = 400;
  const M = { l: 52, r: 24, t: 20, b: 40 };
  const iw = Math.max(width - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  const ss = points.flatMap((p) => [p.s0, p.s1]).filter((v) => v > 0);
  const ms = points.flatMap((p) => [p.m0, p.m1]);
  const sLo = Math.min(...ss) / 1.35;
  const sHi = Math.max(...ss) * 1.35;
  // 이익률이 극단인 작은 묶음 하나가 축을 망치지 않도록 −100%~100% 안에서만 그린다 (넘는 점은 가장자리)
  const mPad = Math.max((Math.max(...ms) - Math.min(...ms)) * 0.12, 0.01);
  const mLo = Math.max(Math.min(...ms) - mPad, -1);
  const mHi = Math.min(Math.max(...ms) + mPad, 1);
  const X = (s: number) => M.l + ((Math.log(Math.max(s, sLo)) - Math.log(sLo)) / (Math.log(sHi) - Math.log(sLo))) * iw;
  const Y = (m: number) => M.t + (1 - (clamp(m, mLo, mHi) - mLo) / (mHi - mLo)) * ih;
  const maxS = Math.max(...points.map((p) => p.s1));
  const R = (s: number) => 4 + 16 * Math.sqrt(Math.max(s, 0) / maxS);
  const mTicks = niceTicks(mLo, mHi, 5);
  const done = elapsed >= DUR + points.length * GAP;

  // 큰 원이 작은 원을 가리지 않도록 매출 큰 순으로 먼저 그린다 (points는 매출 큰 순)
  return (
    <div ref={box} className="il-momentum-chart">
      <div ref={ref} style={{ position: 'relative' }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="묶음별 매출·GP율 이동 궤적">
            {mTicks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={M.l + iw} y1={Y(t)} y2={Y(t)} stroke="var(--viz-grid)" strokeWidth={0.7} />
                <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className="il-tick">{pct(t, 0)}</text>
              </g>
            ))}
            {logTicks(sLo, sHi).map((t) => (
              <g key={t}>
                <line x1={X(t)} x2={X(t)} y1={M.t} y2={M.t + ih} stroke="var(--viz-grid)" strokeWidth={0.7} />
                <text x={X(t)} y={H - 20} textAnchor="middle" className="il-tick">{salesTick(t)}</text>
              </g>
            ))}
            <text x={M.l + iw / 2} y={H - 3} textAnchor="middle" className="il-tick il-axis-title">총매출 (로그 척도) →</text>
            <text x={M.l - 44} y={M.t - 6} className="il-tick il-axis-title">↑ {rateName}</text>

            {points.map((p, i) => {
              const k = momentumKind(p);
              const t = easeOut(clamp((elapsed - i * GAP) / DUR, 0, 1));
              const x0 = X(p.s0);
              const y0 = Y(p.m0);
              const x = x0 + (X(p.s1) - x0) * t;
              const y = y0 + (Y(p.m1) - y0) * t;
              const r = R(p.s0) + (R(p.s1) - R(p.s0)) * t;
              const sel = p.key === selKey;
              // 라벨이 오른쪽 끝을 넘으면 원 왼쪽에 붙인다 (글자 폭 어림 11px)
              const flip = x + r + 4 + p.label.length * 11 > width;
              return (
                <g
                  key={p.key}
                  className={`il-mpt ${sel ? 'is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.label}: ${KIND_LABEL[k]}, 매출 ${eok(p.s0)}→${eok(p.s1)}, ${rateName} ${pct(p.m0)}→${pct(p.m1)}`}
                  onClick={() => onPick(p.key)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onPick(p.key);
                  }}
                >
                  <circle cx={x0} cy={y0} r={R(p.s0)} fill="none" stroke={KIND_COLOR[k]} strokeOpacity={0.45} strokeDasharray="2 2" />
                  <line x1={x0} y1={y0} x2={x} y2={y} stroke={KIND_COLOR[k]} strokeWidth={sel ? 2.5 : 1.6} strokeOpacity={0.7} />
                  <circle cx={x} cy={y} r={r} fill={KIND_COLOR[k]} fillOpacity={sel ? 0.9 : 0.55} stroke={sel ? 'var(--text)' : 'var(--surface)'} strokeWidth={sel ? 2 : 1} />
                  {(i < LABELS || sel) && (
                    <text x={flip ? x - r - 4 : x + r + 4} y={y + 4} textAnchor={flip ? 'end' : 'start'} className={`il-mlabel ${done ? 'on' : ''}`}>{p.label}</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <button type="button" className="il-replay" onClick={() => setRun((v) => v + 1)} aria-label="이동 애니메이션 다시 재생">↻ 다시 재생</button>
      </div>
    </div>
  );
}
