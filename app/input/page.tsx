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
    <div className="data-page">
      <div className="page-intro">
        <h1>장려금·일반비 입력</h1>
        <p>
          제품계층 LV1별 월 전체 비용을 입력합니다. 저장한 금액은 손익 현황과 월별 추이에 반영됩니다.
          {d.storage === 'local' && ' 현재 입력값은 개발 환경에 저장됩니다.'}
        </p>
        <details className="method-note"><summary>입력 및 저장 안내</summary><p>월별 숫자는 입력 완료 계층 수 / 매출 발생 계층 수입니다. 저장 시 선택한 월·제품계층의 기존 금액을 갱신합니다. 마감월은 실적 비용, 당월은 월 전체 예상 비용을 입력합니다. 입력 금액은 해당 제품계층 내 제품별 매출 비중으로 배부됩니다.</p></details>
      </div>
      <InputGrid items={items} inputs={inputs} months={blocks.map(({ ym, kind }) => ({ ym, kind }))} curYm={d.curYm} />
    </div>
  );
}
