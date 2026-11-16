import Link from 'next/link';
import AmountGrid, { type AmountItem, type SavedAmount } from '@/components/amount-grid';
import PlanPanel from '@/components/plan-panel';
import TargetPanel, { type TargetMonthStatus } from '@/components/target-panel';
import IncentivePanel, { type IncentiveGroupStatus } from '@/components/incentive-panel';
import { summarize } from '@/lib/incentive';
import { getIncentiveSheet, incentiveSheetUrl } from '@/lib/incentive-sheet';
import { getPlanSheet, planSheetUrl } from '@/lib/plan-sheet';
import { getChannelInputs, getChannelTotals, getIncentiveGroups, getMonthBlocks, getPlanItems, getSgaLink, getTargets } from '@/lib/data';
import { forecastFactor, ORPHAN_NAME } from '@/lib/pnl';
import { monthLabel, yearStartOf, ymRange } from '@/lib/period';

export const dynamic = 'force-dynamic';

type Tab = 'incentive' | 'general' | 'target' | 'plan';
const TABS: { id: Tab; href: string; label: string }[] = [
  { id: 'incentive', href: '/input', label: '장려금 · 시트' },
  { id: 'general', href: '/input?tab=general', label: '일반비 · 고객그룹3' },
  { id: 'plan', href: '/input?tab=plan', label: '판매계획 · LV3' },
  { id: 'target', href: '/input?tab=target', label: '목표 · 제품' },
];

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
const bySales = (a: AmountItem, b: AmountItem) => sum(b.ref) - sum(a.ref) || a.key.localeCompare(b.key);

export default async function InputPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab: q } = await searchParams;
  const tab: Tab = q === 'general' || q === 'target' || q === 'plan' ? q : 'incentive';
  const { d, blocks } = await getMonthBlocks();
  const sheetUrl = process.env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit` : null;

  let body: React.ReactNode;
  let intro: React.ReactNode;
  if (tab === 'incentive') {
    // 장려금: 별도 구글 시트(영업그룹 탭 × 고객그룹3 × 카테고리)에서 입력. 판관비 연동 달 다음 달부터
    const [link, totals, groups, sheet] = await Promise.all([getSgaLink(), getChannelTotals(), getIncentiveGroups(), getIncentiveSheet()]);
    const lastLinked = link.months.at(-1)?.ym ?? '';
    const yearEnd = `${d.curYm.slice(0, 4)}12`;
    const months = ymRange(yearStartOf(d.curYm), yearEnd).filter((ym) => ym > lastLinked);
    const k = forecastFactor(d.progress.elapsed, d.progress.daysInMonth);
    const salesOf = new Map(totals.groups.map((g) => [g.code, g.sales]));
    const refSales = (sg: string, ym: string) => {
      const s = salesOf.get(sg) ?? {};
      if (ym === d.curYm) return (s[ym] ?? 0) * k;
      return s[ym] ?? (s[d.curYm] ?? 0) * k; // 미래 달은 당월 월말 예상
    };
    const status: Record<string, IncentiveGroupStatus[]> = {};
    for (const ym of months) {
      const sum = new Map(summarize(sheet.records, ym).map((x) => [x.sg, x]));
      const list: IncentiveGroupStatus[] = groups.map((g) => {
        const x = sum.get(g.sg);
        sum.delete(g.sg);
        return { sg: g.sg, sgt: g.sgt, cells: g.cells.length, sales: refSales(g.sg, ym), rows: x?.rows ?? 0, filled: x?.filled ?? 0, total: x?.total ?? 0 };
      });
      for (const x of sum.values()) list.push({ sg: x.sg, sgt: x.sgt, cells: 0, sales: refSales(x.sg, ym), rows: x.rows, filled: x.filled, total: x.total });
      status[ym] = list;
    }
    intro = (
      <>
        장려금은 장려금 구글 시트에서 영업그룹 탭마다 고객그룹 × 카테고리(제품라인)별 10개 항목 금액을 입력하고, 그 칸의 제품별 매출 비중으로 배부합니다. 입력 금액은 월 전체 금액이며 누계 손익에는 월 진행률만큼 반영합니다.{' '}
        {link.months.length ? (
          <>
            <b>{`${monthLabel(link.months[0].ym)}~${monthLabel(lastLinked)}`}</b>은 판관비 대시보드 연동 데이터를 쓰므로 입력하지 않습니다.
          </>
        ) : null}
      </>
    );
    body = months.length ? (
      <IncentivePanel months={months} curYm={d.curYm} status={status} sheetUrl={incentiveSheetUrl()} sheetError={sheet.error} />
    ) : (
      <p className="card px-4 py-3 text-sm">입력할 달이 없습니다. 모든 달이 판관비 대시보드 연동 데이터로 채워져 있습니다.</p>
    );
  } else if (tab === 'general') {
    // 판관비 대시보드 연동 달(올해 1월 ~ 내보낸 마지막 달)은 연동 데이터를 쓰므로 그 뒤의 달만 입력한다
    const [link, totals, saved] = await Promise.all([getSgaLink(), getChannelTotals(), getChannelInputs()]);
    const lastLinked = link.months.at(-1)?.ym ?? '';
    const months = blocks.map((b) => b.ym).filter((ym) => ym > lastLinked);
    // 참고 매출: 마감월은 실적, 당월은 월말 예상 (입력 금액이 월 전체 금액이라 같은 기준으로 비율을 본다)
    const k = forecastFactor(d.progress.elapsed, d.progress.daysInMonth);
    const toItem = (t: { code: string; name: string; sales: Record<string, number> }): AmountItem => ({
      key: t.code,
      label: t.name,
      ref: Object.fromEntries(Object.entries(t.sales).map(([ym, v]) => [ym, ym === d.curYm ? v * k : v])),
    });
    const list = totals.channels.map(toItem);
    for (const s of saved) if (!list.some((it) => it.key === s.ch)) list.push({ key: s.ch, label: s.cht || s.ch, ref: {} });
    const amounts: SavedAmount[] = saved.map((s) => ({ ym: s.ym, key: s.ch, amount: s.general, updatedAt: s.updatedAt, updatedBy: s.updatedBy }));
    const what = '일반비는 고객그룹3별 월 금액을 입력하고, 그 고객그룹3 안에서 제품별 매출 비중으로 배부합니다';
    intro = (
      <>
        {what}. 입력 금액은 월 전체 금액이며 누계 손익에는 월 진행률만큼 반영합니다.{' '}
        <b>{link.months.length ? `${monthLabel(link.months[0].ym)}~${monthLabel(lastLinked)}` : ''}</b>
        {link.months.length ? '은 판관비 대시보드 연동 데이터를 쓰므로 입력하지 않습니다.' : ''}
      </>
    );
    body = months.length ? (
      <AmountGrid
        key={tab}
        kind="ch"
        rowName="고객그룹3"
        fieldLabel="일반비"
        refLabel="매출 (당월은 월말 예상)"
        items={list.sort(bySales)}
        saved={amounts}
        months={months}
        initialYm={d.curYm}
      />
    ) : (
      <p className="card px-4 py-3 text-sm">입력할 달이 없습니다. 모든 달이 판관비 대시보드 연동 데이터로 채워져 있습니다.</p>
    );
  } else if (tab === 'plan') {
    // 판매계획: 구글 시트 plan_lv3 탭(행 = LV3, 열 = 월)에서 직접 입력. 여기서는 행 깔기와 입력한 값 확인
    const [{ months, items }, sheet] = await Promise.all([getPlanItems(), getPlanSheet()]);
    const plans: Record<string, Record<string, number>> = {};
    for (const p of sheet.plans) (plans[p.ym] ??= {})[p.l3] = (plans[p.ym][p.l3] ?? 0) + p.sales;
    const inSheet = new Set(sheet.l3s);
    intro = '제품계층 LV3별 월 판매계획(매출 금액)은 구글 시트에서 직접 입력합니다. 입력한 당월 계획은 경영 요약·손익 분석의 ‘당월 예상’ 매출에 그대로 반영됩니다. 계획이 LV3 단위라 ‘판매계획 대비’ 분석도 LV3까지입니다.';
    body = (
      <PlanPanel
        months={months}
        curYm={d.curYm}
        items={items.map((i) => ({ l1t: i.l1t, l2t: i.l2t, l3: i.l3, l3t: i.l3t, ref: i.ref, inSheet: inSheet.has(i.l3) }))}
        plans={plans}
        sheetUrl={planSheetUrl(sheet.gid)}
        sheetError={sheet.error}
        sheetMonths={sheet.months}
        skipped={d.planFcst?.skipped ?? []}
      />
    );
  } else {
    // 목표: 올해 1월 ~ 12월, 올해 매출이 있는 제품 (매출 큰 순)
    const targets = await getTargets();
    const yearMonths = ymRange(yearStartOf(d.curYm), `${d.curYm.slice(0, 4)}12`);
    const ytd = new Map<string, { name: string; sales: number }>();
    for (const b of blocks) {
      for (const r of b.rows) {
        if (r.name === ORPHAN_NAME) continue;
        const p = ytd.get(r.matnr) ?? { name: r.name, sales: 0 };
        p.sales += r.amt.sales;
        ytd.set(r.matnr, p);
      }
    }
    const products = [...ytd].filter(([, p]) => p.sales > 0).sort((a, b) => b[1].sales - a[1].sales).map(([matnr, p]) => ({ matnr, name: p.name }));
    const status: TargetMonthStatus[] = yearMonths.map((ym) => {
      const list = targets.filter((t) => t.ym === ym);
      return {
        ym,
        rows: list.length,
        filled: new Set(list.filter((t) => t.sales || t.gp || t.op).map((t) => t.matnr)).size,
        sales: list.reduce((s, t) => s + t.sales, 0),
        gp: list.reduce((s, t) => s + t.gp, 0),
        op: list.reduce((s, t) => s + t.op, 0),
      };
    });
    intro = '제품별 월 목표(매출·GP·OP)는 구글 시트에서 입력합니다. 입력한 목표는 제품별 손익 분석의 목표·목표비에 반영됩니다.';
    body = <TargetPanel months={yearMonths} curYm={d.curYm} status={status} products={products} sheetUrl={sheetUrl} />;
  }

  return (
    <div className={tab === 'target' ? 'mapping-page' : 'data-page'}>
      <div className="page-intro">
        <h1>비용·계획 입력</h1>
        <p>
          {intro}
          {d.storage === 'local' && ' 현재 입력값은 개발 환경에 저장됩니다.'}
        </p>
      </div>
      <nav className="view-switch" aria-label="입력 종류">
        {TABS.map((t) => (
          <Link key={t.id} href={t.href} prefetch={false} aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
