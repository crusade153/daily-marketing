'use client';

import { Fragment, useMemo, useState } from 'react';
import { growth, mil, pct, ppt, tone, won } from '@/lib/format';
import { changeOf, gradeChanges, gradePair, gradeUnitKey, type GradeChange } from '@/lib/grade';
import { axisKey, groupBy, metrics, priceChange, sortGroups, totalOf, unitPrice, type Axis, type Group, type Metrics } from '@/lib/pnl';
import { monthLabel, shiftYm } from '@/lib/period';
import GradeAlert from './grade-alert';
import { GradeShift } from './grade-chip';
import { SCENARIO_LABEL, type MaterialRow, type Scenario, type TargetMap } from '@/lib/types';

export type PivotMode = 'product' | 'channel';
type Slot = Axis | 'none';

// 손익 분석 축 이름. 제품계층 LV 구조는 보여주지 않는다 (2026-10-30 사용자 요청)
export const PIVOT_LABEL: Partial<Record<Axis, string>> = {
  cm: 'CM',
  owner: 'PM',
  category: '제품라인',
  name: '제품',
  ch: '채널(고객그룹3)',
  l1: '브랜드',
  rep: '영업담당자',
};

const MODES: Record<PivotMode, { axes: Axis[]; depth: number; presets: { label: string; slots: Slot[] }[] }> = {
  product: {
    axes: ['cm', 'owner', 'category', 'name', 'ch', 'l1'],
    depth: 6,
    presets: [
      { label: 'CM › PM › 제품라인 › 제품', slots: ['cm', 'owner', 'category', 'name', 'none', 'none'] },
      { label: 'CM › PM › 제품라인 › 제품 › 채널', slots: ['cm', 'owner', 'category', 'name', 'ch', 'none'] },
      { label: '브랜드 › 제품', slots: ['l1', 'name', 'none', 'none', 'none', 'none'] },
      { label: '제품', slots: ['name', 'none', 'none', 'none', 'none', 'none'] },
    ],
  },
  channel: {
    axes: ['rep', 'ch', 'name', 'cm', 'l1'],
    depth: 4,
    presets: [
      { label: '영업담당자 › 채널 › 제품', slots: ['rep', 'ch', 'name', 'none'] },
      { label: '채널 › 제품', slots: ['ch', 'name', 'none', 'none'] },
      { label: '영업담당자 › 채널 › CM › 제품', slots: ['rep', 'ch', 'cm', 'name'] },
    ],
  },
};
const MOBILE_PAGE = 60;

type SortBy = 'sales' | 'gp' | 'op';
const SORT_LABEL: Record<SortBy, string> = { sales: '매출순', gp: 'GP순', op: '영업이익순' };

/** 한 묶음의 표시값 */
interface Ctx {
  m: Metrics;
  p: Metrics;
  t: [number, number, number] | null; // 목표 [매출, GP, OP]
  price: number | null; // 총매출 ÷ 수량 (묶음은 수량 가중평균)
  prevPrice: number | null;
  priceChg: number | null; // 제품 하나면 단가 증감, 여러 개면 동일제품 단가 변동률
  single: boolean;
  /** 제품 하나면 그 등급 변화, 여러 개면 안의 악화·개선 품목 수 */
  grade: { one: ReturnType<typeof changeOf> } | { down: number; up: number };
}

interface Col {
  id: string;
  group: string;
  label: string;
  title?: string;
  detail?: boolean; // '전체 지표'에서만
  target?: boolean; // 목표 (제품별 모드만)
  sort?: SortBy; // 머리글을 누르면 이 값으로 정렬
  cell: (c: Ctx) => { v: React.ReactNode; cls?: string };
}

const ach = (actual: number, target: number | undefined) => (target && target > 0 ? actual / target : null);
const achCell = (actual: number, target: number | undefined) => {
  const r = ach(actual, target);
  return { v: pct(r), cls: r == null ? 'text-muted' : r >= 1 ? 'text-[var(--pos)]' : 'text-[var(--neg)]' };
};
/** 등급 열: 제품은 전월 → 당월 등급, 묶음은 안의 악화(▼)·개선(▲) 품목 수 */
const gradeCol: Col = {
  id: 'grade',
  group: '등급',
  label: '전월→당월',
  title: 'ABCD 등급 변화 (순매출 5천만원 × 영업이익 0 기준). 묶음은 안의 악화▼·개선▲ 품목 수',
  cell: (c) => {
    if ('one' in c.grade) return { v: c.grade.one ? <GradeShift from={c.grade.one.from} to={c.grade.one.to} trend={c.grade.one.trend} compact /> : '-', cls: 'grade-cell' };
    const { down, up } = c.grade;
    return {
      v: down || up ? (
        <span className="grade-count">
          {down > 0 && <span className="dn">▼{down}</span>}
          {up > 0 && <span className="up">▲{up}</span>}
        </span>
      ) : (
        <span className="text-muted">·</span>
      ),
      cls: 'grade-cell',
    };
  },
};

const priceCols: Col[] = [
  { id: 'price', group: '판가 (원/EA)', label: '판가', title: '총매출 ÷ 판매수량 (묶음·합계는 수량 가중평균)', cell: (c) => ({ v: c.price == null ? '-' : won(c.price) }) },
  {
    id: 'pchg',
    group: '판가 (원/EA)',
    label: '증감',
    title: '제품: 전월 대비 단가 증감 · 묶음: 동일제품 단가 변동률(전월 수량 고정)',
    cell: (c) => ({ v: pct(c.priceChg), cls: tone(c.priceChg) }),
  },
  { id: 'pprice', group: '판가 (원/EA)', label: '전월 판가', detail: true, cell: (c) => ({ v: c.prevPrice == null ? '-' : won(c.prevPrice), cls: 'text-muted' }) },
];

const COLS: Record<PivotMode, Col[]> = {
  product: [
    gradeCol,
    { id: 'tsales', group: '매출', label: '목표', target: true, cell: (c) => ({ v: c.t ? mil(c.t[0]) : '-', cls: 'text-muted' }) },
    { id: 'sales', group: '매출', label: '실적', sort: 'sales', cell: (c) => ({ v: mil(c.m.sales), cls: 'font-semibold' }) },
    { id: 'asales', group: '매출', label: '목표비', target: true, cell: (c) => achCell(c.m.sales, c.t?.[0]) },
    { id: 'psales', group: '매출', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.sales), cls: 'text-muted' }) },
    { id: 'growth', group: '매출', label: '전월비', cell: (c) => ({ v: c.p.sales > 0 ? pct(growth(c.m.sales, c.p.sales)) : '-', cls: tone(c.m.sales - c.p.sales) }) },
    { id: 'inc', group: '매출총이익 (GP)', label: '장려금', detail: true, cell: (c) => ({ v: mil(c.m.incentive) }) },
    { id: 'net', group: '매출총이익 (GP)', label: '순매출', detail: true, cell: (c) => ({ v: mil(c.m.net) }) },
    { id: 'cogs', group: '매출총이익 (GP)', label: '매출원가', detail: true, cell: (c) => ({ v: mil(c.m.cogs) }) },
    { id: 'tgp', group: '매출총이익 (GP)', label: '목표', target: true, cell: (c) => ({ v: c.t ? mil(c.t[1]) : '-', cls: 'text-muted' }) },
    { id: 'gp', group: '매출총이익 (GP)', label: '실적', sort: 'gp', cell: (c) => ({ v: mil(c.m.gp), cls: `font-semibold ${tone(c.m.gp)}` }) },
    { id: 'agp', group: '매출총이익 (GP)', label: '목표비', target: true, cell: (c) => achCell(c.m.gp, c.t?.[1]) },
    { id: 'pgp', group: '매출총이익 (GP)', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.gp), cls: 'text-muted' }) },
    { id: 'gpm', group: '매출총이익 (GP)', label: 'GP율', cell: (c) => ({ v: pct(c.m.gpm), cls: tone(c.m.gpm) }) },
    { id: 'gpd', group: '매출총이익 (GP)', label: '전월비', title: 'GP율 전월 대비 (%p)', detail: true, cell: (c) => ({ v: ppt(c.m.gpm, c.p.gpm), cls: tone((c.m.gpm ?? 0) - (c.p.gpm ?? 0)) }) },
    { id: 'gen', group: '영업이익 (OP)', label: '일반비', detail: true, cell: (c) => ({ v: mil(c.m.general) }) },
    { id: 'top', group: '영업이익 (OP)', label: '목표', target: true, cell: (c) => ({ v: c.t ? mil(c.t[2]) : '-', cls: 'text-muted' }) },
    { id: 'op', group: '영업이익 (OP)', label: '실적', sort: 'op', cell: (c) => ({ v: mil(c.m.op), cls: `font-semibold ${tone(c.m.op)}` }) },
    { id: 'aop', group: '영업이익 (OP)', label: '목표비', target: true, cell: (c) => achCell(c.m.op, c.t?.[2]) },
    { id: 'pop', group: '영업이익 (OP)', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.op), cls: 'text-muted' }) },
    { id: 'opm', group: '영업이익 (OP)', label: 'OP율', cell: (c) => ({ v: pct(c.m.opm), cls: tone(c.m.opm) }) },
    { id: 'opd', group: '영업이익 (OP)', label: '전월비', title: 'OP율 전월 대비 (%p)', detail: true, cell: (c) => ({ v: ppt(c.m.opm, c.p.opm), cls: tone((c.m.opm ?? 0) - (c.p.opm ?? 0)) }) },
    ...priceCols,
  ],
  // 채널별: 영업이익(OP)까지 (2026-11-01 사용자 요청)
  channel: [
    gradeCol,
    { id: 'sales', group: '매출', label: '실적', sort: 'sales', cell: (c) => ({ v: mil(c.m.sales), cls: 'font-semibold' }) },
    { id: 'psales', group: '매출', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.sales), cls: 'text-muted' }) },
    { id: 'growth', group: '매출', label: '전월비', cell: (c) => ({ v: c.p.sales > 0 ? pct(growth(c.m.sales, c.p.sales)) : '-', cls: tone(c.m.sales - c.p.sales) }) },
    { id: 'inc', group: '장려금 · 순매출', label: '장려금', cell: (c) => ({ v: mil(c.m.incentive) }) },
    { id: 'net', group: '장려금 · 순매출', label: '순매출', cell: (c) => ({ v: mil(c.m.net) }) },
    { id: 'cogs', group: '매출총이익 (GP)', label: '매출원가', detail: true, cell: (c) => ({ v: mil(c.m.cogs) }) },
    { id: 'gp', group: '매출총이익 (GP)', label: '실적', sort: 'gp', cell: (c) => ({ v: mil(c.m.gp), cls: `font-semibold ${tone(c.m.gp)}` }) },
    { id: 'pgp', group: '매출총이익 (GP)', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.gp), cls: 'text-muted' }) },
    { id: 'gpm', group: '매출총이익 (GP)', label: 'GP율', cell: (c) => ({ v: pct(c.m.gpm), cls: tone(c.m.gpm) }) },
    { id: 'gpd', group: '매출총이익 (GP)', label: '전월비', title: 'GP율 전월 대비 (%p)', detail: true, cell: (c) => ({ v: ppt(c.m.gpm, c.p.gpm), cls: tone((c.m.gpm ?? 0) - (c.p.gpm ?? 0)) }) },
    { id: 'gen', group: '영업이익 (OP)', label: '일반비', detail: true, cell: (c) => ({ v: mil(c.m.general) }) },
    { id: 'op', group: '영업이익 (OP)', label: '실적', sort: 'op', cell: (c) => ({ v: mil(c.m.op), cls: `font-semibold ${tone(c.m.op)}` }) },
    { id: 'pop', group: '영업이익 (OP)', label: '전월', title: '전월 실적 (원가 결산 전이면 추정 원가)', cell: (c) => ({ v: mil(c.p.op), cls: 'text-muted' }) },
    { id: 'opm', group: '영업이익 (OP)', label: 'OP율', cell: (c) => ({ v: pct(c.m.opm), cls: tone(c.m.opm) }) },
    { id: 'opd', group: '영업이익 (OP)', label: '전월비', title: 'OP율 전월 대비 (%p)', detail: true, cell: (c) => ({ v: ppt(c.m.opm, c.p.opm), cls: tone((c.m.opm ?? 0) - (c.p.opm ?? 0)) }) },
    ...priceCols,
  ],
};

/**
 * 손익 피벗. 단계별 드릴다운 (제품별: CM › PM › 제품라인 › 제품 [› 채널], 채널별: 영업담당자 › 채널 › 제품).
 * 장려금·일반비는 제품 × 채널 행에 배부돼 있어 어느 축·단계로 묶어도 합계가 같다.
 * PC는 들여쓰기 표, 모바일은 한 단계씩 들어가는 카드 목록으로 보여준다.
 */
export default function PnlPivot({
  mode,
  rows,
  curYm,
  prevYm,
  progressRate,
  targets,
  exportHref,
}: {
  mode: PivotMode;
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  /** 월 진행률 — 누계 보기의 목표 = 월 목표 × 진행률 */
  progressRate: number;
  targets?: { cur: TargetMap; prev: TargetMap };
  exportHref?: string;
}) {
  const cfg = MODES[mode];
  const [slots, setSlots] = useState<Slot[]>(cfg.presets[0].slots);
  const [scenario, setScenario] = useState<Scenario>('fcst');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(false);
  // 모바일 드릴 경로 (각 단계에서 고른 그룹)
  const [trail, setTrail] = useState<{ key: string; label: string }[]>([]);
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE);
  const [sort, setSort] = useState<{ by: SortBy; asc: boolean }>({ by: 'sales', asc: false });
  const [picked, setPicked] = useState<string | null>(null); // 등급 신호등에서 고른 품목

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
    return rows.filter((r) => [r.name, r.matnr, r.l1t, r.cm, r.category, r.owner, r.cht, r.rep].some((v) => v.toLowerCase().includes(q)));
  }, [rows, query]);

  // 고른 기간의 '전월': 누계·예상은 전월 실적, 전월 실적 보기는 전전월 실적
  const base = scenario === 'prev' ? 'prev2' : 'prev';
  const cols = COLS[mode].filter((c) => (detail || !c.detail) && (!c.target || targets));
  const groups = cols.reduce<{ name: string; span: number }[]>((acc, c) => {
    const last = acc.at(-1);
    if (last?.name === c.group) last.span += 1;
    else acc.push({ name: c.group, span: 1 });
    return acc;
  }, []);
  const groupStart = new Set(cols.filter((c, i) => i === 0 || cols[i - 1].group !== c.group).map((c) => c.id));

  // 등급: 채널별은 제품 × 채널, 제품별은 제품 하나 (검색과 관계없이 전체 행으로)
  const byChannel = mode === 'channel';
  const pair = gradePair(scenario);
  const changes = useMemo(() => gradeChanges(rows, byChannel, pair.from, pair.to), [rows, byChannel, pair.from, pair.to]);
  const changeMap = useMemo(() => new Map(changes.map((c) => [c.key, c])), [changes]);
  const gradeOfGroup = (g: Pick<Group, 'mtd' | 'fcst' | 'prev' | 'prev2' | 'rows'>, single: boolean): Ctx['grade'] => {
    if (single) return { one: changeOf(g[pair.from], g[pair.to]) };
    const seen = new Set<string>();
    let down = 0;
    let up = 0;
    for (const r of g.rows) {
      const k = gradeUnitKey(r, byChannel);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = changeMap.get(k)?.trend;
      if (t === 'down') down += 1;
      else if (t === 'up') up += 1;
    }
    return { down, up };
  };

  const targetMap = scenario === 'prev' ? targets?.prev : targets?.cur;
  const targetScale = scenario === 'mtd' ? progressRate : 1;
  /** 묶음의 목표: 제품 목표 합. 채널로 이미 나뉜 묶음은 제품 목표를 채널로 나눌 수 없어 없음 */
  const targetOf = (list: MaterialRow[], channelSplit: boolean): Ctx['t'] => {
    if (!targetMap || channelSplit) return null;
    const seen = new Set<string>();
    const t: [number, number, number] = [0, 0, 0];
    let any = false;
    for (const r of list) {
      if (seen.has(r.matnr)) continue;
      seen.add(r.matnr);
      const v = targetMap[r.matnr];
      if (!v) continue;
      any = true;
      t[0] += v[0] * targetScale;
      t[1] += v[1] * targetScale;
      t[2] += v[2] * targetScale;
    }
    return any ? t : null;
  };
  const ctxOf = (g: Pick<Group, 'mtd' | 'fcst' | 'prev' | 'prev2' | 'rows'>, channelSplit: boolean): Ctx => {
    const single = g.rows.length > 0 && g.rows.every((r) => r.matnr === g.rows[0].matnr);
    // 묶음·합계는 총매출 ÷ 총수량 = 수량 가중평균 판가. 증감은 구성 변화를 빼려고 동일제품 단가 변동률을 그대로 쓴다
    const price = unitPrice(g[scenario]);
    const prevPrice = unitPrice(g[base]);
    return {
      m: metrics(g[scenario]),
      p: metrics(g[base]),
      t: targetOf(g.rows, channelSplit),
      price,
      prevPrice,
      priceChg: single ? (price != null && prevPrice ? price / prevPrice - 1 : null) : priceChange(g.rows, scenario),
      single,
      grade: gradeOfGroup(g, single),
    };
  };

  const total = useMemo(() => ({ ...totalOf(filtered), rows: filtered }), [filtered]);
  const label = (s: Scenario) => `${monthLabel(s === 'prev' ? prevYm : curYm)} ${SCENARIO_LABEL[s].split(' ')[1]}`;
  // 기본(매출 큰 순)은 CM 고정 순서를 지키고, 다른 정렬은 모든 단계를 그 값으로만 줄 세운다
  const sortVal = (g: Group) => (sort.by === 'sales' ? g[scenario].sales : metrics(g[scenario])[sort.by]);
  const sorted = (list: MaterialRow[], axis: Axis) => {
    const gs = groupBy(list, axis);
    if (sort.by === 'sales' && !sort.asc) return sortGroups(gs, axis, (g) => g[scenario].sales);
    return gs.sort((a, b) => (sort.asc ? sortVal(a) - sortVal(b) : sortVal(b) - sortVal(a)));
  };
  const onSort = (by: SortBy) => setSort((s) => (s.by === by ? { by, asc: !s.asc } : { by, asc: false }));
  const presetIndex = cfg.presets.findIndex((p) => p.slots.every((s, i) => s === slots[i]));
  /** depth 단계까지 채널로 나뉘었는가 (목표는 제품 단위라 채널 아래에서는 없음) */
  const splitAt = (depth: number) => path.slice(0, depth + 1).includes('ch');

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
  const expandTo = (depth: number, rowsToWalk: MaterialRow[] = filtered) => {
    const keys = new Set<string>();
    const walk = (list: MaterialRow[], d: number, prefix: string) => {
      if (d >= depth || d >= path.length - 1) return;
      for (const g of groupBy(list, path[d])) {
        const k = `${prefix}/${g.key}`;
        keys.add(k);
        walk(g.rows, d + 1, k);
      }
    };
    walk(rowsToWalk, 0, '');
    setOpen(keys);
  };

  /** 신호등에서 품목을 고르면 표를 그 제품으로 좁히고 끝까지 펼친다 */
  const pick = (c: GradeChange | null) => {
    setPicked(c?.key ?? null);
    setQuery(c?.matnr ?? '');
    setTrail([]);
    setMobileLimit(MOBILE_PAGE);
    if (c) expandTo(path.length, rows.filter((r) => r.matnr === c.matnr));
    else setOpen(new Set());
  };

  const setSlot = (i: number, v: Slot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = v;
      // 같은 축이 두 번 나오지 않게 뒤 단계에서 지운다
      for (let j = i + 1; j < cfg.depth; j++) if (next[j] !== 'none' && next.slice(0, j).includes(next[j])) next[j] = 'none';
      // '없음' 뒤는 모두 없음
      const cut = next.indexOf('none');
      return cut < 0 ? next : next.map((s, j) => (j > cut ? 'none' : s));
    });
    resetDrill();
  };

  const cells = (c: Ctx) => (
    <>
      {cols.map((col) => {
        const { v, cls } = col.cell(c);
        return (
          <td key={col.id} className={`num ${groupStart.has(col.id) ? 'grp-start' : ''} ${cls ?? ''}`}>
            {v}
          </td>
        );
      })}
    </>
  );

  /** 이름 칸: 제품은 풀네임(최대 2줄) + MATNR */
  const nameText = (axis: Axis, g: Group) => (
    <span className="pivot-name-text">
      <span className="pivot-label">{g.label}</span>
      {axis === 'name' && <span className="pivot-code">{g.key}</span>}
    </span>
  );

  const renderLevel = (list: MaterialRow[], depth: number, prefix: string): React.ReactNode =>
    sorted(list, path[depth]).map((g) => {
      const k = `${prefix}/${g.key}`;
      const axis = path[depth];
      const expandable = depth < path.length - 1;
      const isOpen = expandable && open.has(k);
      return (
        <Fragment key={k}>
          <tr className={`${expandable ? 'cursor-pointer' : ''} ${depth === 0 && expandable ? 'subtotal' : ''}`}>
            <td
              className={`pivot-name ${depth > 0 ? 'text-[12.5px]' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={`${PIVOT_LABEL[axis] ?? axis}: ${g.label}${axis === 'name' ? ` (${g.key})` : ''}`}
            >
              {expandable ? (
                <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="pivot-toggle">
                  <span className="pivot-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  {nameText(axis, g)}
                </button>
              ) : (
                <span className="pivot-toggle">
                  <span className="pivot-caret" aria-hidden="true" />
                  {nameText(axis, g)}
                </span>
              )}
            </td>
            {cells(ctxOf(g, splitAt(depth)))}
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
  const mobileTotal = useMemo(() => ({ ...totalOf(mobileRows), rows: mobileRows }), [mobileRows]);
  const canDrill = mobileLevel < path.length - 1;

  /** 모바일 카드 지표: 매출 · GP · OP(채널별은 순매출) + 판가 줄 */
  const mobileMetrics = (c: Ctx) => {
    const salesSub = c.t ? `목표비 ${pct(ach(c.m.sales, c.t[0]))}` : c.p.sales > 0 ? pct(growth(c.m.sales, c.p.sales)) : '';
    const salesTone = c.t ? tone((ach(c.m.sales, c.t[0]) ?? 1) - 1) : tone(c.m.sales - c.p.sales);
    return (
      <>
        <dl className="m-metrics">
          <div>
            <dt>매출</dt>
            <dd className="font-semibold">{mil(c.m.sales)}</dd>
            {salesSub && <dd className={`m-delta ${salesTone}`}>{salesSub}</dd>}
          </div>
          <div>
            <dt>GP</dt>
            <dd className={tone(c.m.gp)}>{mil(c.m.gp)} <small className={tone(c.m.gpm)}>{pct(c.m.gpm)}</small></dd>
            {c.t ? <dd className="m-delta text-muted">목표비 {pct(ach(c.m.gp, c.t[1]))}</dd> : <dd className={`m-delta ${tone((c.m.gpm ?? 0) - (c.p.gpm ?? 0))}`}>{ppt(c.m.gpm, c.p.gpm)}</dd>}
          </div>
          <div>
            <dt>OP</dt>
            <dd className={tone(c.m.op)}>{mil(c.m.op)} <small className={tone(c.m.opm)}>{pct(c.m.opm)}</small></dd>
            {c.t ? <dd className="m-delta text-muted">목표비 {pct(ach(c.m.op, c.t[2]))}</dd> : <dd className={`m-delta ${tone((c.m.opm ?? 0) - (c.p.opm ?? 0))}`}>{ppt(c.m.opm, c.p.opm)}</dd>}
          </div>
        </dl>
        {'one' in c.grade && c.grade.one && c.grade.one.trend !== 'same' && (
          <p className="m-grade">
            등급 <GradeShift from={c.grade.one.from} to={c.grade.one.to} trend={c.grade.one.trend} />
            {c.grade.one.shift && <span> · {c.grade.one.shift}</span>}
          </p>
        )}
        {(c.price != null || c.priceChg != null) && (
          <p className="m-price">
            판가 {c.price != null ? `${won(c.price)}원` : '-'}
            {c.priceChg != null && <span className={tone(c.priceChg)}> {c.single ? '전월비' : '동일제품'} {pct(c.priceChg)}</span>}
          </p>
        )}
      </>
    );
  };

  const periodName = (p: 'prev2' | Scenario) => (p === 'prev2' ? `${monthLabel(shiftYm(prevYm, -1))} 실적` : label(p));

  return (
    <>
    <GradeAlert
      changes={changes}
      fromLabel={periodName(pair.from)}
      toLabel={periodName(pair.to)}
      unitLabel={byChannel ? '제품·채널' : '제품'}
      picked={picked}
      onPick={pick}
    />
    <div className="card pivot-card">
      <div className="pivot-controls">
        <div className="pivot-row">
          <div className="pivot-scenario" role="group" aria-label="기간">
            {(['mtd', 'fcst', 'prev'] as Scenario[]).map((s) => (
              <button key={s} type="button" aria-pressed={scenario === s} onClick={() => setScenario(s)}>
                {label(s)}
              </button>
            ))}
          </div>
          <label className="pivot-field">
            <span>분석 순서</span>
            <select
              value={presetIndex}
              onChange={(e) => {
                const i = Number(e.target.value);
                if (i >= 0) {
                  setSlots(cfg.presets[i].slots);
                  resetDrill();
                }
              }}
            >
              {presetIndex < 0 && <option value={-1}>직접 선택</option>}
              {cfg.presets.map((p, i) => (
                <option key={p.label} value={i}>{p.label}</option>
              ))}
            </select>
          </label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
              resetDrill();
            }}
            placeholder={mode === 'product' ? 'CM·PM·제품명·제품코드 검색' : '영업담당자·채널·제품 검색'}
            aria-label="손익 검색"
            className="pivot-search"
          />
          <div className="segmented" role="group" aria-label="정렬 (각 단계 안에서)">
            {(['sales', 'op'] as SortBy[]).map((by) => (
              <button key={by} type="button" aria-pressed={sort.by === by} onClick={() => setSort({ by, asc: false })}>
                {SORT_LABEL[by]}
              </button>
            ))}
          </div>
          <div className="segmented only-pc" role="group" aria-label="표시할 손익 지표">
            <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>핵심 지표</button>
            <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>전체 지표</button>
          </div>
          {exportHref && (
            <a href={exportHref} download className="pivot-export only-pc" title="제품 × 채널 손익 원천 (당월 누계·예상·전월, 올해 월별)">
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
                {cfg.axes.filter((a) => a === s || !slots.slice(0, i).includes(a)).map((a) => (
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
          <span className="ml-auto text-xs text-muted">
            단위: 백만원 · 판가 원 · 이익률 순매출 대비{targets ? ' · 목표비 = 실적 ÷ 목표' : ''}{scenario === 'mtd' && targets ? ' (누계는 목표 × 진행률)' : ''}
          </span>
        </div>
      </div>

      {/* PC: 들여쓰기 피벗 표 */}
      <div className="data-scroll only-pc">
        <table className={`dtable pivot-dtable pivot-${mode}`}>
          <thead>
            <tr className="pivot-group-row">
              <th rowSpan={2} className="pivot-name text-left">{path.map((a) => PIVOT_LABEL[a]).join(' › ')}</th>
              {groups.map((g, i) => (
                <th key={`${g.name}-${i}`} colSpan={g.span} className="grp-start">{g.name}</th>
              ))}
            </tr>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.id}
                  className={`num ${groupStart.has(c.id) ? 'grp-start' : ''}`}
                  title={c.title}
                  aria-sort={c.sort && sort.by === c.sort ? (sort.asc ? 'ascending' : 'descending') : undefined}
                >
                  {c.sort ? (
                    <button type="button" className={`pivot-sort ${sort.by === c.sort ? 'is-on' : ''}`} onClick={() => onSort(c.sort!)} title={`${c.group} ${c.label} 순으로 정렬 (다시 누르면 반대로)`}>
                      {c.label}
                      <span aria-hidden="true">{sort.by === c.sort ? (sort.asc ? '▴' : '▾') : '↕'}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td className="pivot-name">합계</td>
              {cells(ctxOf(total, false))}
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
          {mobileMetrics(ctxOf(mobileTotal, splitAt(mobileLevel - 1)))}
        </div>
        <ul className="m-list">
          {mobileGroups.slice(0, mobileLimit).map((g) => {
            const axis = path[mobileLevel];
            const body = (
              <>
                <div className="m-card-head">
                  <b className="m-name">{g.label}</b>
                  {canDrill && <span className="m-chevron" aria-hidden="true">›</span>}
                </div>
                {axis === 'name' && <p className="m-sub">{g.key}</p>}
                {mobileMetrics(ctxOf(g, splitAt(mobileLevel)))}
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
        <p className="m-foot">단위: 백만원 · 이익률 순매출 대비{targets ? ' · 목표비 = 실적 ÷ 목표' : ''}</p>
      </div>
    </div>
    </>
  );
}
