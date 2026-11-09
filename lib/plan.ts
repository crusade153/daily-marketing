// 판매계획 대비 실적 순수 계산. 계획은 제품계층 LV3 × 월(구글 시트 plan_lv3)이라 분석 최소 단위도 LV3다.
//   제품계층 코드 길이 3·8·13 (LV1·LV2·LV3): LV1 = LV3 앞 3자리, LV2 = 앞 8자리 → 매출이 없는 계획 행도 상위 계층에 붙일 수 있다
//   누계 보기는 월 계획 × 월 진행률과 비교한다 (목표비와 같은 방식)

import type { Amounts, Hierarchy, Scenario } from './types';

/** 판매계획 한 줄 (원, EA) */
export interface PlanLv3 {
  ym: string; // YYYYMM
  l3: string;
  l3t: string;
  sales: number;
  qty: number;
  updatedAt: string;
  updatedBy: string;
}

export interface PlanValue {
  sales: number;
  qty: number;
}

/** LV3 → 그 달 계획 (같은 LV3가 여러 줄이면 합산) */
export type PlanMap = Record<string, PlanValue & { l3t: string }>;

export function planMapOf(plans: PlanLv3[], ym: string): PlanMap {
  const out: PlanMap = {};
  for (const p of plans) {
    if (p.ym !== ym || !p.l3) continue;
    const v = out[p.l3] ?? { sales: 0, qty: 0, l3t: p.l3t };
    v.sales += p.sales;
    v.qty += p.qty;
    if (!v.l3t) v.l3t = p.l3t;
    out[p.l3] = v;
  }
  return out;
}

export const l1Of = (l3: string) => l3.slice(0, 3);
export const l2Of = (l3: string) => l3.slice(0, 8);

/** 계획 분석에 필요한 행 모양: 제품계층 + 시나리오별 금액 */
export type PlanSourceRow = Pick<Hierarchy, 'l1' | 'l1t' | 'l2' | 'l2t' | 'l3' | 'l3t'> & Record<Scenario, Pick<Amounts, 'sales' | 'qty'>>;

export interface PlanNode {
  level: 1 | 2 | 3;
  key: string;
  label: string;
  /** 계획 (그 아래 LV3 계획 합). 계획이 하나도 없으면 null */
  plan: PlanValue | null;
  actual: PlanValue;
  /** 계획이 있는 LV3의 실적 합 — 달성률 분모와 짝 (계획 없는 LV3 매출은 빠진다) */
  plannedActual: PlanValue;
  /** 아래 LV3 수, 그중 계획이 있는 수 */
  lv3: number;
  planned: number;
  children: PlanNode[];
}

export interface PlanTree {
  total: PlanNode;
  nodes: PlanNode[];
}

const add = (a: PlanValue, b: PlanValue) => {
  a.sales += b.sales;
  a.qty += b.qty;
};

/**
 * LV1 › LV2 › LV3 트리. scale = 계획에 곱할 배수 (누계 보기 = 월 진행률).
 * 매출·수량이 0이고 계획도 없는 LV3는 뺀다.
 */
export function buildPlanTree(rows: PlanSourceRow[], scenario: Scenario, plan: PlanMap, scale = 1): PlanTree {
  const leaves = new Map<string, PlanNode & { l1: string; l1t: string; l2: string; l2t: string }>();
  const leaf = (l3: string, l3t: string, l1: string, l1t: string, l2: string, l2t: string) => {
    let n = leaves.get(l3);
    if (!n) {
      n = { level: 3, key: l3, label: l3t || l3 || '(미지정)', plan: null, actual: { sales: 0, qty: 0 }, plannedActual: { sales: 0, qty: 0 }, lv3: 1, planned: 0, children: [], l1, l1t, l2, l2t };
      leaves.set(l3, n);
    }
    return n;
  };
  const names = { l1: new Map<string, string>(), l2: new Map<string, string>() };
  for (const r of rows) {
    const a = r[scenario];
    if (!a.sales && !a.qty) continue;
    add(leaf(r.l3, r.l3t, r.l1, r.l1t, r.l2, r.l2t).actual, a);
    if (r.l1) names.l1.set(r.l1, r.l1t);
    if (r.l2) names.l2.set(r.l2, r.l2t);
  }
  for (const [l3, p] of Object.entries(plan)) {
    if (!p.sales && !p.qty) continue;
    const l1 = l1Of(l3);
    const l2 = l2Of(l3);
    const n = leaf(l3, p.l3t, l1, names.l1.get(l1) ?? l1, l2, names.l2.get(l2) ?? l2);
    n.plan = { sales: p.sales * scale, qty: p.qty * scale };
    n.planned = 1;
    n.plannedActual = { ...n.actual };
  }

  const group = (level: 1 | 2, key: string, label: string): PlanNode => ({ level, key, label, plan: null, actual: { sales: 0, qty: 0 }, plannedActual: { sales: 0, qty: 0 }, lv3: 0, planned: 0, children: [] });
  const roll = (parent: PlanNode, child: PlanNode) => {
    parent.children.push(child);
    add(parent.actual, child.actual);
    add(parent.plannedActual, child.plannedActual);
    parent.lv3 += child.lv3;
    parent.planned += child.planned;
    if (child.plan) {
      parent.plan ??= { sales: 0, qty: 0 };
      add(parent.plan, child.plan);
    }
  };
  const l1s = new Map<string, PlanNode>();
  const l2s = new Map<string, PlanNode>();
  for (const n of leaves.values()) {
    const k2 = `${n.l1}|${n.l2}`;
    let g2 = l2s.get(k2);
    if (!g2) l2s.set(k2, (g2 = group(2, n.l2, n.l2t || n.l2 || '(미지정)')));
    roll(g2, { level: n.level, key: n.key, label: n.label, plan: n.plan, actual: n.actual, plannedActual: n.plannedActual, lv3: n.lv3, planned: n.planned, children: n.children });
  }
  for (const [k2, g2] of l2s) {
    const l1 = k2.split('|')[0];
    let g1 = l1s.get(l1);
    if (!g1) l1s.set(l1, (g1 = group(1, l1, names.l1.get(l1) || l1 || '(미지정)')));
    roll(g1, g2);
  }
  const total = group(1, 'total', '합계');
  const sortTree = (list: PlanNode[]) => {
    list.sort((a, b) => Math.max(b.actual.sales, b.plan?.sales ?? 0) - Math.max(a.actual.sales, a.plan?.sales ?? 0) || a.key.localeCompare(b.key));
    for (const n of list) sortTree(n.children);
  };
  const nodes = [...l1s.values()];
  for (const n of nodes) {
    add(total.actual, n.actual);
    add(total.plannedActual, n.plannedActual);
    total.lv3 += n.lv3;
    total.planned += n.planned;
    if (n.plan) {
      total.plan ??= { sales: 0, qty: 0 };
      add(total.plan, n.plan);
    }
  }
  sortTree(nodes);
  return { total, nodes };
}

/** 달성률 = 계획이 있는 LV3의 실적 ÷ 계획. 계획이 0 이하면 null */
export const achieve = (actual: number, plan: number | undefined) => (plan && plan > 0 ? actual / plan : null);
