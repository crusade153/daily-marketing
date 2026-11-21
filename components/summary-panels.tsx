'use client';

import { useState, type ReactNode } from 'react';

export default function SummaryPanels({ statement, outlook }: { statement: ReactNode; outlook: ReactNode }) {
  const [view, setView] = useState<'statement' | 'outlook'>('statement');
  return (
    <div className="summary-panels" data-view={view}>
      <div className="segmented summary-detail-switch" aria-label="손익 상세 보기" role="group">
        <button type="button" onClick={() => setView('statement')} aria-pressed={view === 'statement'}>손익표</button>
        <button type="button" onClick={() => setView('outlook')} aria-pressed={view === 'outlook'}>실적 전망</button>
      </div>
      <div className="summary-detail detail-statement">{statement}</div>
      <div className="summary-detail detail-outlook">{outlook}</div>
    </div>
  );
}
