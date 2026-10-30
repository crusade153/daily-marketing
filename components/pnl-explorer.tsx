'use client';

import { useMemo, useState } from 'react';
import PnlPivot from './pnl-pivot';
import ProductTable from './product-table';
import { byProduct, ORPHAN_NAME } from '@/lib/pnl';
import type { MaterialRow, TargetMap } from '@/lib/types';

export type ExplorerView = 'pivot' | 'product';

/** 제품별 손익 분석: 계층 피벗과 제품 목록을 한 화면에서 전환한다 (같은 손익 행을 쓴다) */
export default function PnlExplorer({
  rows,
  curYm,
  prevYm,
  progressRate,
  targets,
  initialView,
}: {
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  progressRate: number;
  targets: { cur: TargetMap; prev: TargetMap };
  initialView: ExplorerView;
}) {
  const [view, setView] = useState<ExplorerView>(initialView);
  // 제품 목록은 제품 한 줄 (채널 행을 합친다)
  const products = useMemo(() => byProduct(rows.filter((r) => r.name !== ORPHAN_NAME)), [rows]);
  const choose = (v: ExplorerView) => {
    setView(v);
    // 새로고침·공유해도 같은 보기로 열리게 주소만 바꾼다 (서버 재요청 없음)
    window.history.replaceState(null, '', v === 'pivot' ? '/hierarchy' : '/hierarchy?view=product');
  };
  return (
    <>
      <div className="view-switch" role="group" aria-label="보기 방식">
        <button type="button" aria-pressed={view === 'pivot'} onClick={() => choose('pivot')}>계층별 손익</button>
        <button type="button" aria-pressed={view === 'product'} onClick={() => choose('product')}>제품 목록</button>
      </div>
      {view === 'pivot' ? (
        <PnlPivot mode="product" rows={rows} curYm={curYm} prevYm={prevYm} progressRate={progressRate} targets={targets} exportHref="/hierarchy/export" />
      ) : (
        <ProductTable rows={products} curYm={curYm} prevYm={prevYm} />
      )}
    </>
  );
}
