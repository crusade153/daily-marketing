'use client';

import Link from 'next/link';
import { useState } from 'react';
import { eok, pct, tone } from '@/lib/format';

type Category = { key: string; label: string; sales: number; gp: number; gpm: number | null };

export default function CategoryOverview({ categories }: { categories: Category[] }) {
  const [metric, setMetric] = useState<'sales' | 'gp'>('sales');
  const sorted = [...categories].sort((a, b) => metric === 'gp' ? Math.abs(b.gp) - Math.abs(a.gp) : b.sales - a.sales);
  const rest = sorted.slice(6);
  const restSales = rest.reduce((sum, g) => sum + g.sales, 0);
  const restGp = rest.reduce((sum, g) => sum + g.gp, 0);
  const displayed = sorted.length > 7 ? [...sorted.slice(0, 6), {
    key: '__rest', label: `그 외 ${rest.length}개 계층`, sales: restSales, gp: restGp, gpm: restSales ? restGp / restSales : null,
  }] : sorted;
  const max = Math.max(...displayed.map((g) => Math.abs(g[metric])), 1);
  const hasNegative = displayed.some((g) => g[metric] < 0);
  return (
    <section className="card category-panel">
      <div className="panel-heading">
        <div><h2>제품계층별 실적 전망</h2><p>제품계층 LV1 · 당월 예상</p></div>
        <div className="segmented" role="group" aria-label="제품계층 비교 지표">
          <button type="button" aria-pressed={metric === 'sales'} onClick={() => setMetric('sales')}>매출</button>
          <button type="button" aria-pressed={metric === 'gp'} onClick={() => setMetric('gp')}>매출이익</button>
        </div>
      </div>
      <div className="ranking-heading"><span>제품계층</span><span>{metric === 'sales' ? '예상 매출' : '예상 매출이익'} · 억원</span><span>매출이익률</span></div>
      <div className="category-list" tabIndex={0} aria-label="제품계층별 예상 실적 목록">
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
              <span className={`num ${tone(g.gpm)}`}>{pct(g.gpm)}</span>
            </div>
          );
        })}
      </div>
      <div className="panel-footer"><span>{metric === 'gp' ? '영향 금액순' : '매출순'} · {sorted.length > 7 ? '상위 6개 외 합산' : `${categories.length}개 계층`}</span><Link href="/hierarchy" prefetch={false}>전체 계층 분석 →</Link></div>
    </section>
  );
}
