'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { eok, mil, pct, signedMil, tone } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import { achieve, buildPlanTree, type PlanMap, type PlanNode, type PlanSourceRow } from '@/lib/plan';
import { SCENARIO_LABEL, type Scenario } from '@/lib/types';

const achCls = (r: number | null) => (r == null ? 'text-muted' : r >= 1 ? 'text-[var(--pos)]' : 'text-[var(--neg)]');

/** 판매계획 대비 실적: 브랜드(LV1) › LV2 › LV3. 계획이 LV3 단위라 LV3 아래(제품)로는 내려가지 않는다 */
export default function PlanView({
  rows,
  curYm,
  prevYm,
  progressRate,
  plans,
}: {
  rows: PlanSourceRow[];
  curYm: string;
  prevYm: string;
  progressRate: number;
  plans: { cur: PlanMap; prev: PlanMap };
}) {
  const [scenario, setScenario] = useState<Scenario>('fcst');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyPlanned, setOnlyPlanned] = useState(false);

  const plan = scenario === 'prev' ? plans.prev : plans.cur;
  const scale = scenario === 'mtd' ? progressRate : 1;
  const tree = useMemo(() => buildPlanTree(rows, scenario, plan, scale), [rows, scenario, plan, scale]);
  const ym = scenario === 'prev' ? prevYm : curYm;
  const label = (s: Scenario) => `${monthLabel(s === 'prev' ? prevYm : curYm)} ${SCENARIO_LABEL[s].split(' ')[1]}`;
  const actualLabel = SCENARIO_LABEL[scenario].split(' ')[1];
  const t = tree.total;
  const totalAch = achieve(t.plannedActual, t.plan);
  const unplanned = t.actual - t.plannedActual;

  const toggle = (k: string) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const expandAll = (depth: 0 | 1 | 2) => {
    const keys = new Set<string>();
    if (depth >= 1)
      for (const a of tree.nodes) {
        keys.add(a.key);
        if (depth >= 2) for (const b of a.children) keys.add(`${a.key}/${b.key}`);
      }
    setOpen(keys);
  };

  const cells = (n: PlanNode) => {
    const r = achieve(n.plannedActual, n.plan);
    return (
      <>
        <td className="num grp-start text-muted">{n.plan != null ? mil(n.plan) : '-'}</td>
        <td className="num font-semibold">{mil(n.actual)}</td>
        <td className={`num ${achCls(r)}`}>{pct(r)}</td>
        <td className={`num ${n.plan != null ? tone(n.plannedActual - n.plan) : 'text-muted'}`}>{n.plan != null ? signedMil(n.plannedActual - n.plan) : '-'}</td>
        <td className="num grp-start text-muted">{n.level === 3 ? (n.planned ? '계획' : '미수립') : `${n.planned}/${n.lv3}`}</td>
      </>
    );
  };

  const render = (list: PlanNode[], depth: number, prefix: string): React.ReactNode =>
    list
      .filter((n) => !onlyPlanned || n.planned > 0)
      .map((n) => {
        const k = prefix ? `${prefix}/${n.key}` : n.key;
        const expandable = n.children.length > 0;
        const isOpen = expandable && open.has(k);
        return (
          <Fragment key={k}>
            <tr className={depth === 0 ? 'subtotal' : ''}>
              <td className={`pivot-name ${depth > 0 ? 'text-[12.5px]' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} title={`${['브랜드', 'LV2', 'LV3'][depth]}: ${n.label} (${n.key})`}>
                {expandable ? (
                  <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="pivot-toggle">
                    <span className="pivot-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span className="pivot-name-text"><span className="pivot-label">{n.label}</span></span>
                  </button>
                ) : (
                  <span className="pivot-toggle">
                    <span className="pivot-caret" aria-hidden="true" />
                    <span className="pivot-name-text">
                      <span className="pivot-label">{n.label}</span>
                      <span className="pivot-code">{n.key}</span>
                    </span>
                  </span>
                )}
              </td>
              {cells(n)}
            </tr>
            {isOpen && render(n.children, depth + 1, k)}
          </Fragment>
        );
      });

  return (
    <div className="card pivot-card">
      <section className="kpi-grid" aria-label="판매계획 요약">
        <div className="card kpi-card">
          <div className="kpi-title">{monthLabel(ym)} 판매계획{scenario === 'mtd' ? ' (× 진행률)' : ''}</div>
          <div className="kpi-value">{t.plan != null ? eok(t.plan) : '미입력'}</div>
          <div className="kpi-sub">계획 LV3 {t.planned}/{t.lv3}개</div>
        </div>
        <div className="card kpi-card kpi-primary">
          <div className="kpi-title">{label(scenario)} 매출</div>
          <div className="kpi-value">{eok(t.actual)}</div>
          <div className="kpi-sub">계획 있는 LV3 {eok(t.plannedActual)}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-title">매출 달성률</div>
          <div className={`kpi-value ${achCls(totalAch)}`}>{pct(totalAch)}</div>
          <div className="kpi-sub">{t.plan != null ? `차이 ${signedMil(t.plannedActual - t.plan)}백만원` : '계획을 입력하면 계산합니다'}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-title">계획 미수립 LV3 매출</div>
          <div className="kpi-value">{eok(unplanned)}</div>
          <div className="kpi-sub">{t.actual ? `전체 매출의 ${pct(unplanned / t.actual)} · 달성률 계산에서 제외` : ''}</div>
        </div>
      </section>

      <div className="pivot-row">
        <div className="pivot-scenario" role="group" aria-label="기간">
          {(['mtd', 'fcst', 'prev'] as Scenario[]).map((s) => (
            <button key={s} type="button" aria-pressed={scenario === s} onClick={() => setScenario(s)}>
              {label(s)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyPlanned} onChange={(e) => setOnlyPlanned(e.target.checked)} />
          계획 있는 계층만
        </label>
        <div className="flex gap-1 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandAll(1)}>LV2 펼침</button>
          <button type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandAll(2)}>LV3 펼침</button>
          <button type="button" className="rounded px-2 py-1 hover:bg-surface-2" onClick={() => expandAll(0)}>모두 접기</button>
        </div>
        <span className="ml-auto text-xs text-muted">단위: 백만원{scenario === 'mtd' ? ' · 누계는 월 계획 × 진행률과 비교' : ''}</span>
      </div>

      {t.plan == null && (
        <p className="px-4 py-3 text-sm">
          {monthLabel(ym)} 판매계획이 아직 없습니다. <Link href="/input?tab=plan" prefetch={false} className="font-semibold text-accent underline">판매계획 입력 →</Link>
        </p>
      )}

      <div className="data-scroll">
        <table className="dtable pivot-dtable">
          <thead>
            <tr className="pivot-group-row">
              <th rowSpan={2} className="pivot-name text-left">브랜드 › LV2 › LV3</th>
              <th colSpan={4} className="grp-start">매출</th>
              <th rowSpan={2} className="grp-start num" title="LV3: 계획 여부 · 묶음: 계획 있는 LV3 / 전체 LV3">계획</th>
            </tr>
            <tr>
              <th className="num grp-start">계획</th>
              <th className="num">{actualLabel}</th>
              <th className="num" title="계획 있는 LV3의 실적 ÷ 계획">달성률</th>
              <th className="num" title="계획 있는 LV3의 실적 − 계획">차이</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td className="pivot-name">합계</td>
              {cells(t)}
            </tr>
            {render(tree.nodes, 0, '')}
          </tbody>
        </table>
      </div>
    </div>
  );
}
