'use client';

import { useState } from 'react';
import PnlPivot from './pnl-pivot';
import ProductTable from './product-table';
import { ORPHAN_NAME } from '@/lib/pnl';
import type { MaterialRow } from '@/lib/types';

export type ExplorerView = 'pivot' | 'product';

/** 계층별 손익 + 제품별 매출을 한 화면에서 전환한다 (같은 품목 행을 쓴다) */
export default function PnlExplorer({
  rows,
  curYm,
  prevYm,
  initialView,
}: {
  rows: MaterialRow[];
  curYm: string;
  prevYm: string;
  initialView: ExplorerView;
}) {
  const [view, setView] = useState<ExplorerView>(initialView);
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
        <PnlPivot rows={rows} curYm={curYm} prevYm={prevYm} exportHref="/hierarchy/export" />
      ) : (
        <ProductTable rows={rows.filter((r) => r.name !== ORPHAN_NAME)} curYm={curYm} prevYm={prevYm} />
      )}
    </>
  );
}
