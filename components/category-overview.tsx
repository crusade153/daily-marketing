'use client';

import Link from 'next/link';
import { useState } from 'react';
import { eok, pct, tone } from '@/lib/format';

export type Category = { key: string; label: string; sales: number; gp: number; gpm: number | null; op: number; opm: number | null };
type Metric = 'sales' | 'gp' | 'op';
const METRIC: Record<Metric, { button: string; heading: string }> = {
  sales: { button: '매출', heading: '예상 총매출' },
  gp: { button: 'GP', heading: '예상 매출총이익' },
  op: { button: 'OP', heading: '예상 영업이익' },
};
/** fixedOrder: 받은 순서 그대로 (CM1 → CM2 → CM3 …), 상위 6개 합산도 하지 않는다 */
export type OverviewView = { id: string; label: string; categories: Category[]; fixedOrder?: boolean };

/** 당월 예상 실적 순위: CM / 브랜드 / 채널 중 고른 기준으로 상위 6개 + 나머지 합산 */
export default function CategoryOverview({ views }: { views: OverviewView[] }) {
  const [viewId, setViewId] = useState(views[0]?.id);
  const [metric, setMetric] = useState<Metric>('sales');
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const categories = view?.categories ?? [];
  const sorted = view?.fixedOrder ? categories : [...categories].sort((a, b) => (metric === 'sales' ? b.sales - a.sales : Math.abs(b[metric]) - Math.abs(a[metric])));
  const rest = sorted.slice(6);
  const restSales = rest.reduce((sum, g) => sum + g.sales, 0);
  const restGp = rest.reduce((sum, g) => sum + g.gp, 0);
  const restOp = rest.reduce((sum, g) => sum + g.op, 0);
  const displayed = !view?.fixedOrder && sorted.length > 7 ? [...sorted.slice(0, 6), {
    key: '__rest', label: `그 외 ${rest.length}개`, sales: restSales, gp: restGp, gpm: null, op: restOp, opm: null,
  }] : sorted;
  // 이익률 열: OP를 보면 OP율, 그 밖에는 GP율 (순매출 대비)
  const rateOf = (g: Category) => (metric === 'op' ? g.opm : g.gpm);
  const max = Math.max(...displayed.map((g) => Math.abs(g[metric])), 1);
  const hasNegative = displayed.some((g) => g[metric] < 0);
  return (
    <section className="card category-panel">
      <div className="panel-heading">
        <div><h2>실적 전망</h2><p>{view?.label} · 당월 예상</p></div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <div className="segmented" role="group" aria-label="비교 기준">
            {views.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === view?.id} onClick={() => setViewId(v.id)}>{v.label}</button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="비교 지표">
            {(Object.keys(METRIC) as Metric[]).map((m) => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{METRIC[m].button}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="ranking-heading"><span>{view?.label}</span><span>{METRIC[metric].heading} · 억원</span><span>{metric === 'op' ? 'OP율' : 'GP율'}</span></div>
      <div className="category-list" tabIndex={0} aria-label={`${view?.label}별 예상 실적 목록`}>
        {displayed.map((g, i) => {
          const value = g[metric];
          const width = Math.abs(value) / max * (hasNegative ? 50 : 100);
          return (
            <div key={g.key} className="ranking-row">
              <span className="ranking-name" title={g.label}><span className="ranking-number">{String(i + 1).padStart(2, '0')}</span>{g.label}</span>
              <div className="ranking-measure">
                <div className={`ranking-track ${hasNegative ? 'diverging' : ''}`} aria-hidden="true">
                  <span style={{ width: `${width}%`, left: `${hasNegative ? (value < 0 ? 50 - width : 50) : 0}%`, background: value < 0 ? 'var(--viz-down)' : 'var(--accent)' }} />
                </div>
                <span className="num">{eok(value)}</span>
              </div>
              <span className={`num ${tone(rateOf(g))}`}>{pct(rateOf(g))}</span>
            </div>
          );
        })}
      </div>
      <div className="panel-footer">
        <span>{view?.fixedOrder ? 'CM1 → CM2 → CM3 순' : metric === 'sales' ? '매출순' : '영향 금액순'} · {!view?.fixedOrder && sorted.length > 7 ? '상위 6개 외 합산' : `${categories.length}개`}</span>
        <Link href={view?.id === 'ch' ? '/channels' : '/hierarchy'} prefetch={false}>{view?.id === 'ch' ? '채널별 손익 분석 →' : '제품별 손익 분석 →'}</Link>
      </div>
    </section>
  );
}
