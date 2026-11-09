// 판매계획 대비 실적 순수 계산. 계획은 제품계층 LV3 × 월 매출 금액(구글 시트 plan_lv3)이라 분석 최소 단위도 LV3다.
//   제품계층 코드 길이 3·8·13 (LV1·LV2·LV3): LV1 = LV3 앞 3자리, LV2 = 앞 8자리 → 매출이 없는 계획 행도 상위 계층에 붙일 수 있다
//   누계 보기는 월 계획 × 월 진행률과 비교한다 (목표비와 같은 방식)

import type { Hierarchy, Scenario } from './types';

/** 판매계획 한 줄 (매출 금액, 원) */
export interface PlanLv3 {
  ym: string; // YYYYMM
  l3: string;
  l3t: string;
  sales: number;
  updatedAt: string;
  updatedBy: string;
}

/** LV3 → 그 달 계획 금액 (같은 LV3가 여러 줄이면 합산) */
export type PlanMap = Record<string, { sales: number; l3t: string }>;

export function planMapOf(plans: PlanLv3[], ym: string): PlanMap {
  const out: PlanMap = {};
  for (const p of plans) {
    if (p.ym !== ym || !p.l3) continue;
    const v = out[p.l3] ?? { sales: 0, l3t: p.l3t };
    v.sales += p.sales;
    if (!v.l3t) v.l3t = p.l3t;
    out[p.l3] = v;
  }
  return out;
}

export const l1Of = (l3: string) => l3.slice(0, 3);
export const l2Of = (l3: string) => l3.slice(0, 8);

/** 계획 분석에 필요한 행 모양: 제품계층 + 시나리오별 매출 */
export type PlanSourceRow = Pick<Hierarchy, 'l1' | 'l1t' | 'l2' | 'l2t' | 'l3' | 'l3t'> & Record<Scenario, number>;

export interface PlanNode {
  level: 1 | 2 | 3;
  key: string;
  label: string;
  /** 계획 (그 아래 LV3 계획 합). 계획이 하나도 없으면 null */
  plan: number | null;
  actual: number;
  /** 계획이 있는 LV3의 실적 합 — 달성률 분자 (계획 없는 LV3 매출은 빠진다) */
  plannedActual: number;
  /** 아래 LV3 수, 그중 계획이 있는 수 */
  lv3: number;
  planned: number;
  children: PlanNode[];
}

export interface PlanTree {
  total: PlanNode;
  nodes: PlanNode[];
}

const node = (level: 1 | 2 | 3, key: string, label: string): PlanNode => ({ level, key, label, plan: null, actual: 0, plannedActual: 0, lv3: 0, planned: 0, children: [] });

function roll(parent: PlanNode, child: PlanNode) {
  parent.actual += child.actual;
  parent.plannedActual += child.plannedActual;
  parent.lv3 += child.lv3;
  parent.planned += child.planned;
  if (child.plan != null) parent.plan = (parent.plan ?? 0) + child.plan;
}

/**
 * LV1 › LV2 › LV3 트리. scale = 계획에 곱할 배수 (누계 보기 = 월 진행률).
 * 매출이 0이고 계획도 없는 LV3는 뺀다.
 */
export function buildPlanTree(rows: PlanSourceRow[], scenario: Scenario, plan: PlanMap, scale = 1): PlanTree {
  const leaves = new Map<string, { n: PlanNode; l1: string; l2: string; l2t: string }>();
  const names = { l1: new Map<string, string>(), l2: new Map<string, string>() };
  const leaf = (l3: string, l3t: string, l1: string, l2: string, l2t: string) => {
    let x = leaves.get(l3);
    if (!x) {
      const n = node(3, l3, l3t || l3 || '(미지정)');
      n.lv3 = 1;
      leaves.set(l3, (x = { n, l1, l2, l2t }));
    }
    return x.n;
  };
  for (const r of rows) {
    const v = r[scenario];
    if (!v) continue;
    leaf(r.l3, r.l3t, r.l1, r.l2, r.l2t).actual += v;
    if (r.l1) names.l1.set(r.l1, r.l1t);
    if (r.l2) names.l2.set(r.l2, r.l2t);
  }
  for (const [l3, p] of Object.entries(plan)) {
    if (!p.sales) continue;
    const l2 = l2Of(l3);
    const n = leaf(l3, p.l3t, l1Of(l3), l2, names.l2.get(l2) ?? l2);
    n.plan = p.sales * scale;
    n.planned = 1;
    n.plannedActual = n.actual;
  }

  const l2s = new Map<string, { n: PlanNode; l1: string }>();
  for (const { n, l1, l2, l2t } of leaves.values()) {
    const k = `${l1}|${l2}`;
    let g = l2s.get(k);
    if (!g) l2s.set(k, (g = { n: node(2, l2, l2t || l2 || '(미지정)'), l1 }));
    g.n.children.push(n);
    roll(g.n, n);
  }
  const l1s = new Map<string, PlanNode>();
  for (const { n, l1 } of l2s.values()) {
    let g = l1s.get(l1);
    if (!g) l1s.set(l1, (g = node(1, l1, names.l1.get(l1) || l1 || '(미지정)')));
    g.children.push(n);
    roll(g, n);
  }
  const total = node(1, 'total', '합계');
  const nodes = [...l1s.values()];
  for (const n of nodes) roll(total, n);
  const sortTree = (list: PlanNode[]) => {
    list.sort((a, b) => Math.max(b.actual, b.plan ?? 0) - Math.max(a.actual, a.plan ?? 0) || a.key.localeCompare(b.key));
    for (const n of list) sortTree(n.children);
  };
  sortTree(nodes);
  return { total, nodes };
}

/** 달성률 = 계획이 있는 LV3의 실적 ÷ 계획. 계획이 0 이하면 null */
export const achieve = (actual: number, plan: number | null | undefined) => (plan && plan > 0 ? actual / plan : null);
