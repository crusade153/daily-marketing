import Link from 'next/link';
import NoticeToggle from './notice-toggle';
import { costMissing, manualText, SOURCE_LABEL } from '@/lib/cost-source';
import { eok, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { DashboardData, MonthInputStatus } from '@/lib/types';

/** 확인 사항 막대. 접고 펼 수 있고(NoticeToggle), 접혀 있어도 경고 한 줄은 보인다 */
export default function Notices({ d }: { d: DashboardData }) {
  const { unitSales, rateSales, noneSales } = d.coverage;
  const total = unitSales + rateSales + noneSales;
  const { chTotal, sgTotal } = d.inputStatus;
  const replacement = total > 0 && rateSales + noneSales !== 0;
  const basis = d.costYms.length ? `${monthLabel(d.costYms[0])}~${monthLabel(d.costYms[d.costYms.length - 1])}` : '';
  const prevOpen = d.costOpen.includes(d.prevYm);
  const curOpen = d.costOpen.includes(d.curYm);
  const months: [string, MonthInputStatus][] = [
    [d.prevYm, d.inputStatus.prev],
    [d.curYm, d.inputStatus.cur],
  ];
  const needInput = months.some(([, s]) => s.source === 'none' || (s.source === 'manual' && (s.sg < sgTotal || s.ch < chTotal)));
  const link = d.sgaLink;

  const items: React.ReactNode[] = [
    <span key="food" title="판매조직 1000 중 고객 영업그룹 오드그로서(300)·미식마켓(310)·FBH(320) 매출을 뺍니다. 판관비 대시보드의 식품 매출 모집단과 같고, 연동한 장려금·판관비도 식품만입니다.">
      매출 <b>식품</b> (오드그로서·미식마켓·FBH 제외)
    </span>,
    // 원가 기준월은 항상 보여 준다: 결산 전인 달은 평균에서 빠지므로 달마다 바뀔 수 있다
    <span key="cost">{monthLabel(d.curYm)} 원가 <b>{basis} 평균 단위원가</b></span>,
  ];
  if (d.costOpen.length > 0)
    items.push(
      <span key="open" className="notice-alert" title="CO-PA 실제원가가 그 달 매출의 절반에 못 미치면 원가 결산 전으로 봅니다 (결산 전 1% 안팎, 결산 후 100% 안팎)">
        <b>{d.costOpen.map(monthLabel).join('·')} 원가 결산 전</b>
        {prevOpen && ` · ${monthLabel(d.prevYm)} 실적 원가는 ${basis} 평균으로 추정`}
        {curOpen && ` · ${monthLabel(d.curYm)}은 ${basis} 평균으로 추정`}
      </span>,
    );
  items.push(
    <span
      key="src"
      title={`판관비 대시보드 연동: ${link.lastYm ? `올해 1월~${monthLabel(link.lastYm)}` : '없음'} (마지막 마감 ${link.lastClosed ? monthLabel(link.lastClosed) : '없음'}, ${link.generatedAt.slice(0, 10)} 내보내기). 연동한 달의 일반비는 판관비 전체(인건비 포함)입니다. 그 뒤의 달은 장려금을 영업그룹, 일반비를 고객그룹3으로 수기 입력하고 각 묶음 안에서 제품 매출 비중으로 배부합니다.`}
    >
      장려금·일반비{' '}
      {months.map(([ym, s], i) => (
        <span key={ym} className={costMissing(s) ? 'notice-alert' : undefined}>
          {i > 0 && ' · '}
          {monthLabel(ym)} <b>{SOURCE_LABEL[s.source]}</b>
          {s.source === 'manual' && ` (${manualText(s, sgTotal, chTotal)})`}
        </span>
      ))}
    </span>,
  );
  if (replacement) items.push(<span key="rate">원가율 대체 적용 <b>{pct((rateSales + noneSales) / total)}</b> ({eok(rateSales + noneSales)})</span>);
  if (d.storage === 'local') items.push(<span key="local">입력값은 현재 개발 환경에 저장됩니다.</span>);
  if (needInput)
    items.push(
      <Link key="go" href="/input" prefetch={false} className="notice-action">
        비용 입력 →
      </Link>,
    );

  // 접혀 있을 때 보일 경고: 원가 결산 전, 비용 없는 달
  const missing = months.filter(([, s]) => costMissing(s)).map(([ym]) => monthLabel(ym));
  const alert = [d.costOpen.length ? `${d.costOpen.map(monthLabel).join('·')} 원가 결산 전` : '', missing.length ? `${missing.join('·')} 장려금·일반비 미입력` : ''].filter(Boolean).join(' · ') || null;

  return (
    <NoticeToggle count={items.length - (needInput ? 1 : 0)} alert={alert}>
      {items}
    </NoticeToggle>
  );
}
