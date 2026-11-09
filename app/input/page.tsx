import Link from 'next/link';
import AmountGrid, { type AmountItem, type SavedAmount } from '@/components/amount-grid';
import TargetPanel, { type TargetMonthStatus } from '@/components/target-panel';
import { getChannelInputs, getChannelTotals, getMonthBlocks, getPlans, getSgaLink, getSgInputs, getTargets } from '@/lib/data';
import { l1Of, l2Of } from '@/lib/plan';
import { forecastFactor, ORPHAN_NAME } from '@/lib/pnl';
import { monthLabel, shiftYm, yearStartOf, ymRange } from '@/lib/period';

export const dynamic = 'force-dynamic';

type Tab = 'incentive' | 'general' | 'target' | 'plan';
const TABS: { id: Tab; href: string; label: string }[] = [
  { id: 'incentive', href: '/input', label: '장려금 · 영업그룹' },
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
  if (tab === 'incentive' || tab === 'general') {
    // 판관비 대시보드 연동 달(올해 1월 ~ 내보낸 마지막 달)은 연동 데이터를 쓰므로 그 뒤의 달만 입력한다
    const [link, totals, saved] = await Promise.all([getSgaLink(), getChannelTotals(), tab === 'incentive' ? getSgInputs() : getChannelInputs()]);
    const lastLinked = link.months.at(-1)?.ym ?? '';
    const months = blocks.map((b) => b.ym).filter((ym) => ym > lastLinked);
    // 참고 매출: 마감월은 실적, 당월은 월말 예상 (입력 금액이 월 전체 금액이라 같은 기준으로 비율을 본다)
    const k = forecastFactor(d.progress.elapsed, d.progress.daysInMonth);
    const toItem = (t: { code: string; name: string; sales: Record<string, number> }): AmountItem => ({
      key: t.code,
      label: t.name,
      ref: Object.fromEntries(Object.entries(t.sales).map(([ym, v]) => [ym, ym === d.curYm ? v * k : v])),
    });
    const list = (tab === 'incentive' ? totals.groups : totals.channels).map(toItem);
    for (const s of saved) if (!list.some((it) => it.key === s.ch)) list.push({ key: s.ch, label: s.cht || s.ch, ref: {} });
    const amounts: SavedAmount[] = saved.map((s) => ({ ym: s.ym, key: s.ch, amount: tab === 'incentive' ? s.incentive : s.general, updatedAt: s.updatedAt, updatedBy: s.updatedBy }));
    const what = tab === 'incentive' ? '장려금은 영업그룹별 월 금액을 입력하고, 그 영업그룹 안에서 제품별 매출 비중으로 배부합니다' : '일반비는 고객그룹3별 월 금액을 입력하고, 그 고객그룹3 안에서 제품별 매출 비중으로 배부합니다';
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
        kind={tab === 'incentive' ? 'sg' : 'ch'}
        rowName={tab === 'incentive' ? '영업그룹' : '고객그룹3'}
        fieldLabel={tab === 'incentive' ? '장려금' : '일반비'}
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
    // 판매계획: 올해 1월 ~ 12월(연말이 3개월 안이면 내년 3개월까지), 올해 매출이 있거나 계획이 있는 LV3
    const plans = await getPlans();
    const yearEnd = `${d.curYm.slice(0, 4)}12`;
    const ahead = shiftYm(d.curYm, 3);
    const planMonths = ymRange(yearStartOf(d.curYm), ahead > yearEnd ? ahead : yearEnd);
    const refYms = blocks.filter((b) => b.kind === 'actual').slice(-3).map((b) => b.ym);
    const lv3 = new Map<string, { l1: string; l1t: string; l2: string; l2t: string; l3: string; l3t: string; ref: number; ytd: number }>();
    for (const b of blocks) {
      const ref = refYms.includes(b.ym);
      for (const r of b.rows) {
        if (r.name === ORPHAN_NAME || !r.l3) continue;
        let it = lv3.get(r.l3);
        if (!it) lv3.set(r.l3, (it = { l1: r.l1, l1t: r.l1t, l2: r.l2, l2t: r.l2t, l3: r.l3, l3t: r.l3t, ref: 0, ytd: 0 }));
        it.ytd += r.amt.sales;
        if (ref) it.ref += r.amt.sales / refYms.length;
      }
    }
    const names = new Map([...lv3.values()].flatMap((i) => [[i.l1, i.l1t], [i.l2, i.l2t]] as [string, string][]));
    for (const p of plans) {
      if (lv3.has(p.l3)) continue;
      const l1 = l1Of(p.l3);
      const l2 = l2Of(p.l3);
      lv3.set(p.l3, { l1, l1t: names.get(l1) ?? l1, l2, l2t: names.get(l2) ?? l2, l3: p.l3, l3t: p.l3t || p.l3, ref: 0, ytd: 0 });
    }
    const planned = new Set(plans.map((p) => p.l3));
    const list = [...lv3.values()].filter((i) => i.ytd > 0 || planned.has(i.l3));
    // LV1 → LV2 → LV3 묶음을 지키면서 올해 매출 큰 순
    const s1 = new Map<string, number>();
    const s2 = new Map<string, number>();
    for (const i of list) {
      s1.set(i.l1, (s1.get(i.l1) ?? 0) + i.ytd);
      s2.set(`${i.l1}|${i.l2}`, (s2.get(`${i.l1}|${i.l2}`) ?? 0) + i.ytd);
    }
    list.sort((a, b) => s1.get(b.l1)! - s1.get(a.l1)! || a.l1.localeCompare(b.l1) || s2.get(`${b.l1}|${b.l2}`)! - s2.get(`${a.l1}|${a.l2}`)! || a.l2.localeCompare(b.l2) || b.ytd - a.ytd || a.l3.localeCompare(b.l3));
    const items: AmountItem[] = list.map((i) => ({ key: i.l3, label: i.l3t, groups: [i.l1t, i.l2t], ref: Object.fromEntries(planMonths.map((m) => [m, i.ref])) }));
    intro = '제품계층 LV3별 월 판매계획(매출 금액)을 입력합니다. 계획이 LV3 단위라 ‘판매계획 대비’ 분석도 LV3까지입니다. 참고 매출은 최근 마감 3개월 월평균입니다.';
    body = (
      <AmountGrid
        kind="plan"
        rowName="제품계층 LV3"
        fieldLabel="매출계획"
        refLabel="최근 3개월 평균 매출"
        items={items}
        saved={plans.map((p) => ({ ym: p.ym, key: p.l3, amount: p.sales, updatedAt: p.updatedAt, updatedBy: p.updatedBy }))}
        months={planMonths}
        initialYm={d.curYm}
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
