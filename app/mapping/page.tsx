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
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">제품 매핑 (CM1·CM2·CM3·카테고리·담당자)</h1>
        <p className="text-xs text-muted">
          매핑은 구글 시트 product_map 탭에서 직접 입력합니다. 열 순서: MATNR | 제품명 | CM1 | CM2 | CM3 | 카테고리 | 담당자. 시트를
          고친 뒤 최대 5분 안에 반영되며, 바로 보려면 상단의 데이터 새로고침을 누르세요.
        </p>
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
            <span className="text-muted">SHEET_ID 미설정 · 로컬 파일(.data/product_map.json) 사용 중</span>
          )}
        </div>
      </section>
      <UnmappedList items={unmapped} />
    </div>
  );
}
