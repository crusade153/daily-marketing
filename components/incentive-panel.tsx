'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createIncentiveRows } from '@/actions/input-actions';
import { eok } from '@/lib/format';
import { monthLabel } from '@/lib/period';

export interface IncentiveGroupStatus {
  sg: string;
  sgt: string;
  /** 매출 있는 고객그룹3 × 카테고리 조합 수 (행 만들기 대상) */
  cells: number;
  /** 참고 매출: 그 달 (당월은 월말 예상) */
  sales: number;
  /** 시트에 그 달 행 수 · 금액 있는 행 수 · 장려금 합계 */
  rows: number;
  filled: number;
  total: number;
}

/** 장려금 입력: 금액은 장려금 구글 시트(영업그룹 탭 × 고객그룹3 × 카테고리)에서 넣고, 여기서는 행 만들기와 현황만 */
export default function IncentivePanel({
  months,
  curYm,
  status,
  sheetUrl,
  sheetError,
}: {
  months: string[];
  curYm: string;
  status: Record<string, IncentiveGroupStatus[]>;
  sheetUrl: string | null;
  sheetError: string | null;
}) {
  const router = useRouter();
  const [ym, setYm] = useState(months.includes(curYm) ? curYm : months[0]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const list = status[ym] ?? [];
  const sum = (k: 'rows' | 'filled' | 'total' | 'cells' | 'sales') => list.reduce((s, g) => s + g[k], 0);

  const make = () =>
    start(async () => {
      const res = await createIncentiveRows({ ym });
      setMsg(
        res.ok
          ? { ok: true, text: res.appended ? `${monthLabel(ym)} 행 ${res.appended.toLocaleString()}개${res.tabs ? `(새 탭 ${res.tabs}개)` : ''}를 시트에 만들었습니다. 시트에서 금액을 입력해 주세요.` : `${monthLabel(ym)} 행이 이미 모두 있습니다.` }
          : { ok: false, text: res.error },
      );
      router.refresh();
    });

  return (
    <div className="card target-panel">
      <div className="target-months" role="group" aria-label="장려금 월">
        {months.map((m) => {
          const filled = (status[m] ?? []).filter((g) => g.total).length;
          return (
            <button key={m} type="button" aria-pressed={ym === m} onClick={() => { setYm(m); setMsg(null); }}>
              <b>{monthLabel(m)}</b>
              <span>{filled ? `${filled}개 영업그룹` : '미입력'}</span>
            </button>
          );
        })}
      </div>
      <div className="target-stats">
        <div><span>시트 행</span><b>{sum('rows').toLocaleString()}</b></div>
        <div><span>금액 입력 행</span><b>{sum('filled').toLocaleString()}</b></div>
        <div><span>장려금 합계</span><b>{eok(sum('total'))}</b></div>
        <div><span>참고 매출</span><b>{eok(sum('sales'))}</b></div>
      </div>
      <div className="target-actions">
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="target-sheet">장려금 시트 열기 ↗</a>
        ) : (
          <span className="text-neg">장려금 시트가 연결되지 않았습니다 (환경변수 INCENTIVE_SHEET_ID).</span>
        )}
        <button type="button" className="lo-save-button" disabled={pending || !sheetUrl || !ym} onClick={make}>
          {pending ? '만드는 중…' : `${monthLabel(ym)} 입력 행 만들기 (${sum('cells').toLocaleString()}개 조합)`}
        </button>
        {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
        {sheetError && <span className="text-neg">시트를 읽지 못했습니다: {sheetError} — 시트가 서비스계정에 편집자로 공유됐는지 확인하세요.</span>}
      </div>
      <div className="data-scroll" style={{ marginTop: 12 }}>
        <table className="dtable">
          <thead>
            <tr>
              <th className="text-left">영업그룹</th>
              <th className="num">조합</th>
              <th className="num">시트 행</th>
              <th className="num">금액 입력 행</th>
              <th className="num">장려금</th>
              <th className="num">참고 매출</th>
              <th className="num">매출 대비</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => (
              <tr key={g.sg}>
                <td>{g.sgt} <span className="text-muted">{g.sg}</span></td>
                <td className="num">{g.cells.toLocaleString()}</td>
                <td className="num">{g.rows ? g.rows.toLocaleString() : <span className="text-muted">없음</span>}</td>
                <td className="num">{g.filled.toLocaleString()}</td>
                <td className="num">{g.total ? eok(g.total) : '-'}</td>
                <td className="num">{eok(g.sales)}</td>
                <td className="num">{g.total && g.sales ? `${((g.total / g.sales) * 100).toFixed(1)}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="method-note target-note">
        <summary>입력 방법</summary>
        <p>장려금 시트의 영업그룹별 탭에서 월·고객그룹3·카테고리별 F~O열에 월 금액(원)을 입력합니다. A~E열은 앱에서 관리합니다.</p>
      </details>
    </div>
  );
}
