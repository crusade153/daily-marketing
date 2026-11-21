import ChannelOwnerEditor from '@/components/channel-owner-editor';
import AnalysisTabs from '@/components/analysis-tabs';
import LineOwnerEditor, { type LineSummary } from '@/components/line-owner-editor';
import UnmappedList, { type UnmappedItem } from '@/components/unmapped-list';
import { getChannelOwners, getDashboard, getLineOwners, getProductMap } from '@/lib/data';
import { eok, pct } from '@/lib/format';
import { byProduct, cmOf, ORPHAN_NAME } from '@/lib/pnl';
import { monthLabel } from '@/lib/period';
import type { LineOwner, ProductMap } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** 가장 많은 값과 나머지 종류 수 */
function topOf(values: string[]): { top: string; others: number } {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  const sorted = [...n].sort((a, b) => b[1] - a[1]);
  return { top: sorted[0]?.[0] ?? '', others: Math.max(sorted.length - 1, 0) };
}

/** 시트 제품라인(카테고리)별 요약 + 저장된 CM·PM 이름 */
function lineSummaries(maps: ProductMap[], owners: LineOwner[], salesByMatnr: Map<string, number>): LineSummary[] {
  const byLine = new Map<string, ProductMap[]>();
  for (const m of maps) if (m.category) byLine.set(m.category, [...(byLine.get(m.category) ?? []), m]);
  const saved = new Map(owners.map((o) => [o.line, o]));
  return [...byLine]
    .map(([line, list]) => {
      const mark = topOf(list.map(cmOf));
      const owner = topOf(list.map((m) => m.owner));
      const o = saved.get(line);
      return {
        line,
        products: list.length,
        sales: list.reduce((s, m) => s + (salesByMatnr.get(m.matnr) ?? 0), 0),
        mark: mark.others ? `${mark.top} 외 ${mark.others}` : mark.top,
        markKey: mark.top,
        sheetOwner: owner.others ? `${owner.top} 외 ${owner.others}` : owner.top,
        cm: o?.cm ?? '',
        pm: o?.pm ?? '',
        updatedAt: o?.updatedAt ?? '',
        updatedBy: o?.updatedBy ?? '',
      };
    })
    .sort((a, b) => b.sales - a.sales);
}

export default async function MappingPage() {
  const [d, maps, lineOwners, chOwners] = await Promise.all([getDashboard(), getProductMap(), getLineOwners(), getChannelOwners()]);
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  // 손익 행은 제품 × 채널 → 제품 단위로 합친다
  const products = byProduct(d.rows.filter((r) => r.name !== ORPHAN_NAME));
  const salesBy = new Map(products.map((r) => [r.matnr, r.fcst.sales]));
  const lines = lineSummaries(maps, lineOwners, salesBy);
  // 채널(고객그룹3) 목록: 당월 예상 + 전월 매출 큰 순, 저장된 영업담당자
  const savedRep = new Map(chOwners.map((c) => [c.ch, c]));
  const chMap = new Map<string, { ch: string; cht: string; sales: number }>();
  for (const r of d.rows) {
    if (r.name === ORPHAN_NAME) continue;
    const c = chMap.get(r.ch) ?? { ch: r.ch, cht: r.cht, sales: 0 };
    c.sales += r.fcst.sales + r.prev.sales;
    chMap.set(r.ch, c);
  }
  for (const c of chOwners) if (!chMap.has(c.ch)) chMap.set(c.ch, { ch: c.ch, cht: c.cht, sales: 0 });
  const channels = [...chMap.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((c) => ({ ...c, rep: savedRep.get(c.ch)?.rep ?? '', updatedAt: savedRep.get(c.ch)?.updatedAt ?? '', updatedBy: savedRep.get(c.ch)?.updatedBy ?? '' }));
  const unlined = maps.filter((m) => !m.category).length;

  const isMapped = (matnr: string) => {
    const m = mapBy.get(matnr);
    return !!m && (cmOf(m) !== '(미매핑)' || !!m.category || !!m.owner);
  };

  let mappedSales = 0;
  let totalSales = 0;
  const unmapped: UnmappedItem[] = [];
  for (const r of products) {
    const s = Math.abs(r.mtd.sales) + Math.abs(r.prev.sales);
    totalSales += s;
    if (isMapped(r.matnr)) mappedSales += s;
    else
      unmapped.push({
        matnr: r.matnr,
        name: r.name,
        l1t: r.l1t,
        l2t: r.l2t,
        curSales: r.mtd.sales,
        prevSales: r.prev.sales,
        inSheet: mapBy.has(r.matnr),
      });
  }
  unmapped.sort((a, b) => Math.abs(b.curSales) + Math.abs(b.prevSales) - (Math.abs(a.curSales) + Math.abs(a.prevSales)));

  const sheetUrl = process.env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit` : null;
  const owners = new Set(maps.map((m) => m.owner).filter(Boolean));

  return (
    <div className="mapping-page">
      <div className="page-intro">
        <h1>제품 매핑 관리</h1>
        {sheetUrl && <a className="heading-action" href={sheetUrl} target="_blank" rel="noreferrer">제품 매핑 시트 ↗</a>}
      </div>
      <section className="grid grid-cols-2 gap-3 mapping-kpis">
        <div className="card px-4 py-3">
          <div className="text-xs text-muted">매핑된 매출 비중 (당월+전월)</div>
          <div className="text-2xl font-bold">{pct(totalSales ? mappedSales / totalSales : null)}</div>
          <div className="text-xs text-muted">
            {eok(mappedSales)} / {eok(totalSales)}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-muted">시트 등록 품목 / 담당자 수</div>
          <div className="text-2xl font-bold">
            {maps.length.toLocaleString()} / {owners.size}
          </div>
        </div>
      </section>
      <AnalysisTabs label="제품 매핑 보기" preserve tabs={[
        { label: '미매핑 품목', content: <UnmappedList items={unmapped} /> },
        { label: '제품라인 담당자', content: <LineOwnerEditor lines={lines} unlined={unlined} curLabel={monthLabel(d.curYm) + ' 예상'} /> },
        { label: '채널 담당자', content: <ChannelOwnerEditor channels={channels} /> },
      ]} />
    </div>
  );
}
