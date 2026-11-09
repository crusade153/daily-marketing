import Link from 'next/link';
import InputGrid, { type InputItem, type SavedInput } from '@/components/input-grid';
import PlanInput, { type PlanItem } from '@/components/plan-input';
import TargetPanel, { type TargetMonthStatus } from '@/components/target-panel';
import { getChannelInputs, getChannelTotals, getMonthBlocks, getPlans, getTargets } from '@/lib/data';
import { l1Of, l2Of } from '@/lib/plan';
import { ORPHAN_NAME } from '@/lib/pnl';
import { shiftYm, yearStartOf, ymRange } from '@/lib/period';

export const dynamic = 'force-dynamic';

const total = (it: InputItem) => Object.values(it.sales).reduce((s, v) => s + v, 0);
const bySales = (a: InputItem, b: InputItem) => total(b) - total(a) || a.key.localeCompare(b.key);

export default async function InputPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  const isTarget = tab === 'target';
  const isPlan = tab === 'plan';
  const { d, blocks } = await getMonthBlocks();
  const months = blocks.map(({ ym, kind }) => ({ ym, kind }));
  const sheetUrl = process.env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit` : null;

  let body: React.ReactNode;
  if (isPlan) {
    // 판매계획: 올해 1월 ~ 12월(연말이 3개월 안이면 내년 3개월까지), 올해 매출이 있거나 계획이 있는 LV3
    const plans = await getPlans();
    const yearEnd = `${d.curYm.slice(0, 4)}12`;
    const ahead = shiftYm(d.curYm, 3);
    const planMonths = ymRange(yearStartOf(d.curYm), ahead > yearEnd ? ahead : yearEnd);
    const refYms = blocks.filter((b) => b.kind === 'actual').slice(-3).map((b) => b.ym);
    const lv3 = new Map<string, PlanItem & { ytd: number }>();
    for (const b of blocks) {
      const ref = refYms.includes(b.ym);
      for (const r of b.rows) {
        if (r.name === ORPHAN_NAME || !r.l3) continue;
        let it = lv3.get(r.l3);
        if (!it) lv3.set(r.l3, (it = { l1: r.l1, l1t: r.l1t, l2: r.l2, l2t: r.l2t, l3: r.l3, l3t: r.l3t, refSales: 0, refQty: 0, ytd: 0 }));
        it.ytd += r.amt.sales;
        if (ref) {
          it.refSales += r.amt.sales / refYms.length;
          it.refQty += r.amt.qty / refYms.length;
        }
      }
    }
    const names = new Map([...lv3.values()].flatMap((i) => [[i.l1, i.l1t], [i.l2, i.l2t]] as [string, string][]));
    for (const p of plans) {
      if (lv3.has(p.l3)) continue;
      const l1 = l1Of(p.l3);
      const l2 = l2Of(p.l3);
      lv3.set(p.l3, { l1, l1t: names.get(l1) ?? l1, l2, l2t: names.get(l2) ?? l2, l3: p.l3, l3t: p.l3t || p.l3, refSales: 0, refQty: 0, ytd: 0 });
    }
    const list = [...lv3.values()].filter((i) => i.ytd > 0 || plans.some((p) => p.l3 === i.l3));
    // LV1 → LV2 → LV3 묶음을 지키면서 올해 매출 큰 순
    const sumBy = (key: (i: PlanItem) => string) => {
      const m = new Map<string, number>();
      for (const i of list) m.set(key(i), (m.get(key(i)) ?? 0) + i.ytd);
      return m;
    };
    const s1 = sumBy((i) => i.l1);
    const s2 = sumBy((i) => `${i.l1}|${i.l2}`);
    list.sort((a, b) => (s1.get(b.l1)! - s1.get(a.l1)!) || a.l1.localeCompare(b.l1) || (s2.get(`${b.l1}|${b.l2}`)! - s2.get(`${a.l1}|${a.l2}`)!) || a.l2.localeCompare(b.l2) || b.ytd - a.ytd || a.l3.localeCompare(b.l3));
    body = <PlanInput months={planMonths} curYm={d.curYm} items={list.map((i) => ({ l1: i.l1, l1t: i.l1t, l2: i.l2, l2t: i.l2t, l3: i.l3, l3t: i.l3t, refSales: i.refSales, refQty: i.refQty }))} plans={plans} />;
  } else if (isTarget) {
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
    body = <TargetPanel months={yearMonths} curYm={d.curYm} status={status} products={products} sheetUrl={sheetUrl} />;
  } else {
    const [chTotals, chInputs] = await Promise.all([getChannelTotals(), getChannelInputs()]);
    // 고객그룹3별 월 매출 (마감월 실적, 당월 누계)
    const map = new Map<string, InputItem>(chTotals.map((c) => [c.code, { key: c.code, label: c.name, sales: c.sales }]));
    for (const c of chInputs) if (!map.has(c.ch)) map.set(c.ch, { key: c.ch, label: c.cht || c.ch, sales: {} });
    const items = [...map.values()].sort(bySales);
    const saved: SavedInput[] = chInputs.map((c) => ({
      ym: c.ym,
      key: c.ch,
      incentive: c.incentive,
      general: c.general,
      rate: c.rate,
      updatedAt: c.updatedAt,
      updatedBy: c.updatedBy,
    }));
    body = <InputGrid items={items} inputs={saved} months={months} curYm={d.curYm} />;
  }

  return (
    <div className={isTarget ? 'mapping-page' : 'data-page'}>
      <div className="page-intro">
        <h1>비용·목표 입력</h1>
        <p>
          {isPlan
            ? '제품계층 LV3별 월 판매계획(매출·수량)을 입력합니다. 계획은 LV3 단위라 계획 대비 분석도 LV3까지 내려갑니다(‘판매계획 대비’ 화면).'
            : isTarget
            ? '제품별 월 목표(매출·GP·OP)는 구글 시트에서 입력합니다. 입력한 목표는 제품별 손익 분석의 목표·목표비에 반영됩니다.'
            : '고객그룹3(채널)별 월 장려금·일반비를 입력합니다. 장려금·일반비 고정비는 금액(채널 제품 총매출 비중으로 배부), 일반비 변동비는 총매출 대비 %로 자동 계산됩니다.'}
          {d.storage === 'local' && ' 현재 입력값은 개발 환경에 저장됩니다.'}
        </p>
        {!isTarget && !isPlan && (
          <details className="method-note"><summary>입력 및 저장 안내</summary><p>월별 숫자는 입력 완료 채널 수 / 매출 발생 채널 수입니다. 저장 시 선택한 월·채널의 기존 금액을 갱신합니다. 마감월은 실적 비용, 당월은 월 전체 예상 비용을 입력합니다(누계 손익에는 월 진행률만큼 반영). 일반비 = 고정비(금액 배부) + 변동비(각 제품 총매출 × 변동비율, 누계·예상·마감월 각각의 매출 기준). 순매출 = 총매출 − 장려금, 매출총이익 = 순매출 − 매출원가, 영업이익 = 매출총이익 − 일반비. 그 달 매출이 없는 채널의 금액은 ‘(채널 비용)’ 행에 따로 모입니다.</p></details>
        )}
      </div>
      <nav className="view-switch" aria-label="입력 종류">
        <Link href="/input" prefetch={false} aria-current={isTarget || isPlan ? undefined : 'page'}>비용 · 고객그룹3</Link>
        <Link href="/input?tab=target" prefetch={false} aria-current={isTarget ? 'page' : undefined}>목표 · 제품×월</Link>
        <Link href="/input?tab=plan" prefetch={false} aria-current={isPlan ? 'page' : undefined}>판매계획 · LV3×월</Link>
      </nav>
      {body}
    </div>
  );
}
