import UnmappedList, { type UnmappedItem } from '@/components/unmapped-list';
import { getDashboard, getProductMap } from '@/lib/data';
import { eok, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MappingPage() {
  const [d, maps] = await Promise.all([getDashboard(), getProductMap()]);
  const mapBy = new Map(maps.map((m) => [m.matnr, m]));
  const products = d.rows.filter((r) => !r.matnr.startsWith('L2:'));

  const isMapped = (matnr: string) => {
    const m = mapBy.get(matnr);
    return !!m && !!(m.cm1 || m.cm2 || m.cm3 || m.category || m.owner);
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
    <div className="data-page">
      <div className="page-intro">
        <h1>제품 매핑 관리</h1>
        <p>
          제품별 CM·카테고리·담당자 연결 현황을 확인합니다. 연결 정보는 구글 시트에서 관리하며, 변경 후 최대 5분 이내에 반영됩니다.
        </p>
        <details className="method-note"><summary>매핑 정보 관리 안내</summary><p>구글 시트의 product_map 탭에서 입력합니다. 열 순서: 제품코드(MATNR) | 제품명 | CM1 | CM2 | CM3 | 카테고리 | 담당자. 변경 내용을 즉시 반영하려면 상단 ‘데이터 새로고침’을 선택하세요.</p></details>
      </div>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        <div className="card flex flex-col justify-center px-4 py-3 text-sm">
          {sheetUrl ? (
            <a href={sheetUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
              구글 시트 열기 ↗
            </a>
          ) : (
            <span className="text-muted">개발 환경의 제품 매핑 정보를 사용 중입니다.</span>
          )}
        </div>
      </section>
      <UnmappedList items={unmapped} />
    </div>
  );
}
