'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { appendTargetRows } from '@/actions/input-actions';
import { eok } from '@/lib/format';
import { monthLabel } from '@/lib/period';

export interface TargetMonthStatus {
  ym: string;
  rows: number; // 시트에 그 달 제품 행 수
  filled: number; // 매출 목표가 있는 제품 수
  sales: number;
  gp: number;
  op: number;
}

/** 목표 입력 안내: 목표 금액은 구글 시트에서 입력하고, 여기서는 월별 입력 현황과 제품 행 채우기만 한다 */
export default function TargetPanel({
  months,
  curYm,
  status,
  products,
  sheetUrl,
}: {
  months: string[];
  curYm: string;
  status: TargetMonthStatus[];
  /** 올해 매출이 있는 제품 (매출 큰 순) */
  products: { matnr: string; name: string }[];
  sheetUrl: string | null;
}) {
  const router = useRouter();
  const [ym, setYm] = useState(curYm);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const st = status.find((s) => s.ym === ym) ?? { ym, rows: 0, filled: 0, sales: 0, gp: 0, op: 0 };

  const fill = () =>
    start(async () => {
      const res = await appendTargetRows({ ym, items: products });
      setMsg(res.ok ? { ok: true, text: `${monthLabel(ym)} 제품 행 ${res.appended}개를 시트에 추가했습니다. 시트에서 매출·GP·OP 목표를 입력해 주세요.` } : { ok: false, text: res.error });
      router.refresh();
    });

  return (
    <div className="card target-panel">
      <div className="target-months" role="group" aria-label="목표 월">
        {months.map((m) => {
          const s = status.find((x) => x.ym === m);
          return (
            <button key={m} type="button" aria-pressed={ym === m} onClick={() => { setYm(m); setMsg(null); }}>
              <b>{monthLabel(m)}</b>
              <span>{s?.filled ? `${s.filled}개` : '미입력'}</span>
            </button>
          );
        })}
      </div>
      <div className="target-stats">
        <div><span>시트 제품 행</span><b>{st.rows.toLocaleString()}</b></div>
        <div><span>목표 입력 제품</span><b>{st.filled.toLocaleString()}</b></div>
        <div><span>매출 목표</span><b>{eok(st.sales)}</b></div>
        <div><span>GP 목표</span><b>{eok(st.gp)}</b></div>
        <div><span>OP 목표</span><b>{eok(st.op)}</b></div>
      </div>
      <div className="target-actions">
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="target-sheet">구글 시트 열기 ↗ (탭 target_product)</a>
        ) : (
          <span className="text-muted">개발 환경에서는 로컬 파일(.data/target_product.json)에 저장됩니다.</span>
        )}
        <button type="button" className="lo-save-button" disabled={pending || !products.length} onClick={fill}>
          {pending ? '추가 중…' : `${monthLabel(ym)} 제품 행 채우기 (${products.length.toLocaleString()}개)`}
        </button>
        {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
      </div>
      <details className="method-note target-note">
        <summary>입력 방법</summary>
        <p>
          시트 target_product 탭의 열: YYYYMM · MATNR · 제품명 · 매출목표 · GP목표 · OP목표 (원). ‘제품 행 채우기’는 올해 매출이 있는 제품 중
          그 달 행이 없는 제품만 추가합니다. 같은 달·제품이 두 줄이면 합산됩니다. 손익 분석의 목표비 = 실적 ÷ 목표이며, 누계 보기에서는 월 목표 × 월 진행률과 비교합니다.
          GP 목표는 순매출(총매출 − 장려금) − 매출원가, OP 목표는 GP − 일반비 기준으로 입력합니다.
        </p>
      </details>
    </div>
  );
}
