import Link from 'next/link';
import InputGrid, { type InputItem, type SavedInput } from '@/components/input-grid';
import { getChannelTotals, getMonthBlocks } from '@/lib/data';

export const dynamic = 'force-dynamic';

const total = (it: InputItem) => Object.values(it.sales).reduce((s, v) => s + v, 0);
const bySales = (a: InputItem, b: InputItem) => total(b) - total(a) || a.key.localeCompare(b.key);

export default async function InputPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { by } = await searchParams;
  const channel = by === 'channel';
  const [{ d, blocks, inputs, chInputs }, chTotals] = await Promise.all([
    getMonthBlocks(),
    channel ? getChannelTotals() : Promise.resolve(null),
  ]);
  const months = blocks.map(({ ym, kind }) => ({ ym, kind }));
  const channelYms = [...new Set(chInputs.filter((c) => c.incentive).map((c) => c.ym))];

  let items: InputItem[];
  let saved: SavedInput[];
  if (chTotals) {
    // 고객그룹3별 월 매출 (마감월 실적, 당월 누계)
    const map = new Map<string, InputItem>(chTotals.map((c) => [c.code, { key: c.code, label: c.name, sales: c.sales }]));
    for (const c of chInputs) if (!map.has(c.ch)) map.set(c.ch, { key: c.ch, label: c.cht || c.ch, sales: {} });
    items = [...map.values()].sort(bySales);
    saved = chInputs.map((c) => ({ ym: c.ym, key: c.ch, incentive: c.incentive, general: 0, updatedAt: c.updatedAt, updatedBy: c.updatedBy }));
  } else {
    // 제품계층 LV1별 월 참고 매출 (마감월 실적, 당월 예상)
    const map = new Map<string, InputItem>();
    for (const b of blocks) {
      for (const r of b.rows) {
        if (r.l1.startsWith('CH:')) continue; // 채널 장려금 보관 행
        const it = map.get(r.l1) ?? { key: r.l1, label: r.l1t, sales: {} };
        it.sales[b.ym] = (it.sales[b.ym] ?? 0) + r.amt.sales;
        map.set(r.l1, it);
      }
    }
    for (const i of inputs) if (!map.has(i.l1)) map.set(i.l1, { key: i.l1, label: i.l1t || i.l1, sales: {} });
    items = [...map.values()].sort(bySales);
    saved = inputs.map((i) => ({ ym: i.ym, key: i.l1, incentive: i.incentive, general: i.general, updatedAt: i.updatedAt, updatedBy: i.updatedBy }));
  }

  return (
    <div className="data-page">
      <div className="page-intro">
        <h1>장려금·일반비 입력</h1>
        <p>
          {channel
            ? '고객그룹3별 월 장려금을 입력합니다. 입력한 달은 고객그룹3 금액을 그 채널의 제품별 매출 비중으로 배부하고, 제품계층 LV1의 장려금은 쓰지 않습니다.'
            : '제품계층 LV1별 월 전체 비용을 입력합니다. 저장한 금액은 손익 현황과 월별 추이에 반영됩니다.'}
          {d.storage === 'local' && ' 현재 입력값은 개발 환경에 저장됩니다.'}
        </p>
        <details className="method-note"><summary>입력 및 저장 안내</summary><p>월별 숫자는 입력 완료 행 수 / 매출 발생 행 수입니다. 저장 시 선택한 월·행의 기존 금액을 갱신합니다. 마감월은 실적 비용, 당월은 월 전체 예상 비용을 입력합니다. 제품계층 LV1 금액은 그 계층 안 제품별 매출 비중으로, 고객그룹3 장려금은 그 채널 안 제품별 매출 비중(당월은 누계 매출)으로 배부됩니다. 한 달에 고객그룹3 장려금이 하나라도 있으면 그 달 장려금은 고객그룹3 기준만 쓰고, 일반비는 계속 LV1 입력을 씁니다.</p></details>
      </div>
      <nav className="view-switch" aria-label="입력 기준">
        <Link href="/input" prefetch={false} aria-current={channel ? undefined : 'page'}>제품계층 LV1 · 장려금·일반비</Link>
        <Link href="/input?by=channel" prefetch={false} aria-current={channel ? 'page' : undefined}>고객그룹3 · 장려금</Link>
      </nav>
      <InputGrid
        key={channel ? 'channel' : 'lv1'}
        kind={channel ? 'channel' : 'lv1'}
        items={items}
        inputs={saved}
        months={months}
        curYm={d.curYm}
        channelYms={channelYms}
      />
    </div>
  );
}
