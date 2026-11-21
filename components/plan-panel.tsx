'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPlanRows } from '@/actions/input-actions';
import { eok, mil, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';

export interface PlanPanelItem {
  l1t: string;
  l2t: string;
  l3: string;
  l3t: string;
  /** 최근 마감 3개월 월평균 매출 (원) */
  ref: number;
  /** 시트에 행이 있는지 */
  inSheet: boolean;
}

/** 판매계획 입력: 금액은 구글 시트 plan_lv3 탭(행 = LV3, 열 = 월)에서 넣고, 여기서는 행 깔기와 입력한 값 확인만 */
export default function PlanPanel({
  months,
  curYm,
  items,
  plans,
  sheetUrl,
  sheetError,
  sheetMonths,
  skipped,
}: {
  months: string[];
  curYm: string;
  items: PlanPanelItem[];
  /** 월 → LV3 → 계획 금액 (원) */
  plans: Record<string, Record<string, number>>;
  sheetUrl: string | null;
  sheetError: string | null;
  /** 시트에 있는 월 열 (YYYYMM) */
  sheetMonths: string[];
  /** 당월: 계획은 있으나 매출이 아직 없어 예상에 반영하지 못한 LV3 */
  skipped: { l3: string; l3t: string; sales: number }[];
}) {
  const router = useRouter();
  const [ym, setYm] = useState(months.includes(curYm) ? curYm : months[0]);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const missingRows = items.filter((i) => !i.inSheet).length;
  const missingCols = months.filter((m) => !sheetMonths.includes(m)).length;
  const needSetup = missingRows > 0 || missingCols > 0;

  const make = () =>
    start(async () => {
      const res = await createPlanRows();
      setMsg(
        res.ok
          ? {
              ok: true,
              text: `${res.created ? 'plan_lv3 탭을 만들고 ' : ''}LV3 행 ${res.appended.toLocaleString()}개${res.cols ? ` · 월 열 ${res.cols}개` : ''}를 깔았습니다. 시트에서 월 열에 금액을 입력해 주세요.`,
            }
          : { ok: false, text: res.error },
      );
      router.refresh();
    });

  const plan = plans[ym] ?? {};
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((it) => [it.l1t, it.l2t, it.l3t, it.l3].some((v) => v.toLowerCase().includes(q))) : items;
  const total = shown.reduce((s, it) => ({ ref: s.ref + it.ref, plan: s.plan + (plan[it.l3] ?? 0) }), { ref: 0, plan: 0 });
  const filled = shown.filter((it) => plan[it.l3]).length;
  const heads = shown.map((it, i) => [i === 0 || shown[i - 1].l1t !== it.l1t, i === 0 || shown[i - 1].l1t !== it.l1t || shown[i - 1].l2t !== it.l2t]);

  return (
    <div className="card target-panel">
      <div className="target-months" role="group" aria-label="계획 월">
        {months.map((m) => {
          const n = Object.values(plans[m] ?? {}).filter(Boolean).length;
          return (
            <button key={m} type="button" aria-pressed={ym === m} onClick={() => { setYm(m); setMsg(null); }}>
              <b>{monthLabel(m)}</b>
              <span>{n ? `${n}개 LV3` : '미입력'}</span>
            </button>
          );
        })}
      </div>
      <div className="target-stats">
        <div><span>계획 입력 LV3</span><b>{filled.toLocaleString()} / {shown.length.toLocaleString()}</b></div>
        <div><span>{monthLabel(ym)} 매출계획</span><b>{eok(total.plan)}</b></div>
        <div><span>참고 매출 (최근 3개월 월평균)</span><b>{eok(total.ref)}</b></div>
        <div><span>계획 ÷ 참고</span><b>{pct(total.ref && total.plan ? total.plan / total.ref : null)}</b></div>
      </div>
      <div className="target-actions">
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="target-sheet">판매계획 시트에서 입력 ↗ (탭 plan_lv3)</a>
        ) : (
          <span className="text-neg">운영 시트가 연결되지 않았습니다 (환경변수 SHEET_ID).</span>
        )}
        <button type="button" className="lo-save-button" disabled={pending || !sheetUrl} onClick={make}>
          {pending ? '까는 중…' : needSetup ? `시트에 LV3 행 깔기 (새 LV3 ${missingRows.toLocaleString()}개${missingCols ? ` · 월 열 ${missingCols}개` : ''})` : '참고 매출 갱신'}
        </button>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted">찾기</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-32 rounded-md border border-border bg-surface px-2 py-1.5" />
        </label>
        {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
        {sheetError && <span className="text-neg">시트를 읽지 못했습니다: {sheetError}</span>}
      </div>
      {ym === curYm && skipped.length > 0 && (
        <p className="mt-2 text-[12.5px] text-neg">
          {monthLabel(curYm)} 매출이 아직 없어 예상 매출에 반영하지 못한 계획: {skipped.slice(0, 5).map((s) => `${s.l3t || s.l3} ${eok(s.sales)}`).join(' · ')}
          {skipped.length > 5 ? ` 외 ${skipped.length - 5}개` : ''}
        </p>
      )}
      <div className="data-scroll" style={{ marginTop: 12 }}>
        <table className="dtable">
          <thead>
            <tr>
              <th className="text-left">제품계층 LV3</th>
              <th className="text-left">코드</th>
              <th className="num">참고 매출 (백만원)</th>
              <th className="num">{monthLabel(ym)} 매출계획 (백만원)</th>
              <th className="num" title="매출계획 ÷ 참고 매출">비율</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td colSpan={2}>합계 ({shown.length.toLocaleString()}개)</td>
              <td className="num">{mil(total.ref)}</td>
              <td className="num">{mil(total.plan)}</td>
              <td className="num">{pct(total.ref && total.plan ? total.plan / total.ref : null)}</td>
            </tr>
            {shown.map((it, r) => {
              const v = plan[it.l3] ?? 0;
              return (
                <Fragment key={it.l3}>
                  {heads[r][0] && (
                    <tr className="subtotal">
                      <td colSpan={5} className="font-semibold" style={{ paddingLeft: 8 }}>{it.l1t || '(미지정)'}</td>
                    </tr>
                  )}
                  {heads[r][1] && (
                    <tr>
                      <td colSpan={5} className="text-[12.5px] font-semibold text-muted" style={{ paddingLeft: 22 }}>{it.l2t || '(미지정)'}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ paddingLeft: 36 }}>
                      {it.l3t}
                      {!it.inSheet && <span className="ml-1.5 text-[11px] text-neg">시트에 행 없음</span>}
                    </td>
                    <td className="text-[11px] text-muted">{it.l3}</td>
                    <td className="num text-muted">{mil(it.ref)}</td>
                    <td className={`num ${v ? 'font-semibold' : 'text-muted'}`}>{v ? mil(v) : '-'}</td>
                    <td className="num text-muted">{pct(it.ref && v ? v / it.ref : null)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="method-note target-note">
        <summary>입력 방법</summary>
        <p>시트 plan_lv3의 월 열에 LV3별 매출 계획을 원 단위로 입력합니다. A~E열은 앱에서 관리합니다. 입력한 당월 계획은 경영 요약과 손익 분석의 예상 매출에 반영됩니다.</p>
      </details>
    </div>
  );
}
