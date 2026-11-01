import { GRADE_NAME, type Quadrant, type Trend } from '@/lib/segment';

/** 신호등 색 등급 칩: A 초록 · C 노랑 · B 주황 · D 빨강 */
export function GradeChip({ q, named = false, faded = false }: { q: Quadrant | null; named?: boolean; faded?: boolean }) {
  if (!q) return <span className="grade-chip g-none" title="실적 없음">–</span>;
  return (
    <span className={`grade-chip g-${q} ${faded ? 'is-faded' : ''}`} title={`${q} ${GRADE_NAME[q]}`}>
      {q}
      {named && <em>{GRADE_NAME[q]}</em>}
    </span>
  );
}

const TREND_TEXT: Record<Trend, string> = { down: '악화', up: '개선', same: '유지', new: '신규', gone: '판매 없음' };

/** 등급 변화: 유지는 칩 하나(흐리게), 바뀌면 이전 → 이후 + ▲개선/▼악화 */
export function GradeShift({ from, to, trend, compact = false }: { from: Quadrant | null; to: Quadrant | null; trend: Trend; compact?: boolean }) {
  if (trend === 'same') {
    return (
      <span className="grade-shift t-same" title="등급 유지">
        <GradeChip q={to} faded />
      </span>
    );
  }
  return (
    <span className={`grade-shift t-${trend}`} title={`${from ?? '–'} → ${to ?? '–'} ${TREND_TEXT[trend]}`}>
      <GradeChip q={from} faded />
      <i aria-hidden="true">→</i>
      <GradeChip q={to} />
      {(trend === 'down' || trend === 'up' || !compact) && (
        <b>
          {trend === 'down' ? '▼' : trend === 'up' ? '▲' : ''}
          {!compact && TREND_TEXT[trend]}
        </b>
      )}
    </span>
  );
}
