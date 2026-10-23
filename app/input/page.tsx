import InputGrid, { type L1Item } from '@/components/input-grid';
import { getMonthBlocks } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function InputPage() {
  const { d, blocks, inputs } = await getMonthBlocks();

  // 제품계층 LV1별 월 참고 매출 (마감월 실적, 당월 예상)
  const byL1 = new Map<string, L1Item>();
  for (const b of blocks) {
    for (const r of b.rows) {
      const it = byL1.get(r.l1) ?? { l1: r.l1, l1t: r.l1t, sales: {} };
      it.sales[b.ym] = (it.sales[b.ym] ?? 0) + r.amt.sales;
      byL1.set(r.l1, it);
    }
  }
  for (const i of inputs) {
    if (!byL1.has(i.l1)) byL1.set(i.l1, { l1: i.l1, l1t: i.l1t || i.l1, sales: {} });
  }
  // 기간 매출 큰 순
  const sum = (it: L1Item) => Object.values(it.sales).reduce((s, v) => s + v, 0);
  const items = [...byL1.values()].sort((a, b) => sum(b) - sum(a) || a.l1.localeCompare(b.l1));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">장려금·일반비 입력</h1>
        <p className="text-xs text-muted">
          제품계층 LV1별 월 금액을 입력합니다. 저장하면 구글 시트 manual_input_lv1 탭에 (월, LV1) 기준으로 덮어쓰고, 손익과 월별
          추이에 바로 반영됩니다. 월 버튼 아래 숫자는 입력한 LV1 수 / 그 달 매출이 있는 LV1 수입니다.
          {d.storage === 'local' && ' (현재 SHEET_ID가 없어 로컬 파일에 저장 중)'}
        </p>
      </div>
      <InputGrid items={items} inputs={inputs} months={blocks.map(({ ym, kind }) => ({ ym, kind }))} curYm={d.curYm} />
    </div>
  );
}
