import Link from 'next/link';
import InputGrid, { type InputItem, type SavedInput } from '@/components/input-grid';
import TargetPanel, { type TargetMonthStatus } from '@/components/target-panel';
import { getChannelInputs, getChannelTotals, getMonthBlocks, getTargets } from '@/lib/data';
import { ORPHAN_NAME } from '@/lib/pnl';
import { yearStartOf, ymRange } from '@/lib/period';

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
  const { d, blocks } = await getMonthBlocks();
  const months = blocks.map(({ ym, kind }) => ({ ym, kind }));
  const sheetUrl = process.env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit` : null;

  let body: React.ReactNode;
  if (isTarget) {
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
          {isTarget
            ? '제품별 월 목표(매출·GP·OP)는 구글 시트에서 입력합니다. 입력한 목표는 제품별 손익 분석의 목표·목표비에 반영됩니다.'
            : '고객그룹3(채널)별 월 장려금·일반비 금액을 입력합니다. 그 채널의 제품별 총매출 비중으로 각 제품에 배부됩니다.'}
          {d.storage === 'local' && ' 현재 입력값은 개발 환경에 저장됩니다.'}
        </p>
        {!isTarget && (
          <details className="method-note"><summary>입력 및 저장 안내</summary><p>월별 숫자는 입력 완료 채널 수 / 매출 발생 채널 수입니다. 저장 시 선택한 월·채널의 기존 금액을 갱신합니다. 마감월은 실적 비용, 당월은 월 전체 예상 비용을 입력합니다(누계 손익에는 월 진행률만큼 반영). 순매출 = 총매출 − 장려금, 매출총이익 = 순매출 − 매출원가, 영업이익 = 매출총이익 − 일반비. 그 달 매출이 없는 채널의 금액은 ‘(채널 비용)’ 행에 따로 모입니다.</p></details>
        )}
      </div>
      <nav className="view-switch" aria-label="입력 종류">
        <Link href="/input" prefetch={false} aria-current={isTarget ? undefined : 'page'}>비용 · 고객그룹3</Link>
        <Link href="/input?tab=target" prefetch={false} aria-current={isTarget ? 'page' : undefined}>목표 · 제품×월</Link>
      </nav>
      {body}
    </div>
  );
}
