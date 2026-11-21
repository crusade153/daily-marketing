'use client';

import { useMemo } from 'react';
import AnalysisTabs from './analysis-tabs';
import PnlPivot from './pnl-pivot';
import ProductTable from './product-table';
import { byProduct, ORPHAN_NAME } from '@/lib/pnl';
import type { MaterialRow, TargetMap } from '@/lib/types';

export type ExplorerView = 'pivot' | 'product';

function ProductList({ rows, curYm, prevYm }: { rows: MaterialRow[]; curYm: string; prevYm: string }) {
  const products = useMemo(() => byProduct(rows.filter((r) => r.name !== ORPHAN_NAME)), [rows]);
  return <ProductTable rows={products} curYm={curYm} prevYm={prevYm} />;
}

/** 제품별 손익 분석: 계층 피벗과 제품 목록을 한 화면에서 전환한다 (같은 손익 행을 쓴다) */
export default function PnlExplorer({
  rows,
  curYm,
  prevYm,
  progressRate,
  targets,
  initialView,
  exportHref,
}: {
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  progressRate: number;
  targets: { cur: TargetMap; prev: TargetMap };
  initialView: ExplorerView;
  /** 원천 다운로드 주소 (고른 기준월 포함) */
  exportHref: string;
}) {
  const choose = (index: number) => {
    const url = new URL(window.location.href);
    if (index === 1) url.searchParams.set('view', 'product');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  };
  return (
    <AnalysisTabs label="제품 손익 보기" defaultIndex={initialView === 'product' ? 1 : 0} onSelect={choose} preserve tabs={[
      { label: '계층별 손익', content: <PnlPivot mode="product" rows={rows} curYm={curYm} prevYm={prevYm} progressRate={progressRate} targets={targets} exportHref={exportHref} /> },
      { label: '제품 목록', content: <ProductList rows={rows} curYm={curYm} prevYm={prevYm} /> },
    ]} />
  );
}
