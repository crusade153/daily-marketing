// 판매단가 추이 순수 계산.
//   단순 평균단가(매출 ÷ EA)는 제품 구성(믹스)이 바뀌면 가격이 그대로여도 움직인다 → 그대로 읽으면 오판.
//   그래서 두 갈래로 나눈다.
//   · 동일제품 단가 변동 = 전월·당월 모두 팔린 제품만, 전월 수량을 고정해 단가 변화만 본다 (라스파이레스)
//       Σ(당월 단가 × 전월 수량) ÷ Σ(전월 단가 × 전월 수량) − 1
//   · 믹스·기타 = 평균단가 변동에서 동일제품 단가 변동을 뺀 나머지 (1+평균변동) ÷ (1+단가변동) − 1
//   단가지수 = 첫 달 100에서 동일제품 단가 변동을 연쇄로 곱한 값.
//   단가 비율이 0.2배 미만·5배 초과인 제품은 단위·정정 전표로 보고 비교에서 뺀다.

export interface PriceItem {
  key: string; // 그룹 (LV1 코드)
  sales: number[]; // months 순서
  qty: number[];
}

export interface PricePoint {
  index: number | null; // 첫 달 = 100
  priceChg: number | null; // 동일제품 단가 변동 (전월 대비)
  avgPrice: number | null; // 단순 평균단가 (원/EA)
  avgChg: number | null; // 단순 평균단가 변동
  mixChg: number | null; // 믹스·기타
  coverage: number | null; // 동일제품 비교에 들어간 매출 비중
  matched: number; // 비교 제품 수
}

const RATIO_MIN = 0.2;
const RATIO_MAX = 5;

const valid = (s: number, q: number) => s > 0 && q > 0;

export function pricePoints(items: PriceItem[], n: number): PricePoint[] {
  const out: PricePoint[] = [];
  let last = 100; // 마지막으로 계산된 지수 (비교가 끊긴 달 다음은 여기서 이어간다)
  for (let t = 0; t < n; t++) {
    let vs = 0;
    let vq = 0;
    let total = 0;
    for (const it of items) {
      total += it.sales[t] > 0 ? it.sales[t] : 0;
      if (valid(it.sales[t], it.qty[t])) {
        vs += it.sales[t];
        vq += it.qty[t];
      }
    }
    const avgPrice = vq > 0 ? vs / vq : null;
    if (t === 0) {
      out.push({ index: 100, priceChg: null, avgPrice, avgChg: null, mixChg: null, coverage: null, matched: 0 });
      continue;
    }

    let num = 0; // Σ p_t q_{t-1}
    let den = 0; // Σ p_{t-1} q_{t-1} = 전월 매출
    let covered = 0;
    let matched = 0;
    for (const it of items) {
      const [s0, q0, s1, q1] = [it.sales[t - 1], it.qty[t - 1], it.sales[t], it.qty[t]];
      if (!valid(s0, q0) || !valid(s1, q1)) continue;
      const p0 = s0 / q0;
      const p1 = s1 / q1;
      const r = p1 / p0;
      if (r < RATIO_MIN || r > RATIO_MAX) continue;
      num += p1 * q0;
      den += s0;
      covered += s1;
      matched++;
    }
    const priceChg = den > 0 ? num / den - 1 : null;
    const prevAvg = out[t - 1].avgPrice;
    const avgChg = avgPrice != null && prevAvg ? avgPrice / prevAvg - 1 : null;
    const mixChg = avgChg != null && priceChg != null ? (1 + avgChg) / (1 + priceChg) - 1 : null;
    const index = priceChg != null ? last * (1 + priceChg) : null;
    if (index != null) last = index;
    out.push({ index, priceChg, avgPrice, avgChg, mixChg, coverage: total > 0 ? covered / total : null, matched });
  }
  return out;
}

export interface PriceSeries {
  key: string;
  label: string;
  points: PricePoint[];
}

export interface PriceTrend {
  months: { ym: string; partial: boolean }[]; // partial = 진행 중인 달 (누계 기준)
  series: PriceSeries[]; // [0] = 전체, 이후 LV1 매출 큰 순
}

export function buildPriceTrend(
  months: { ym: string; partial: boolean }[],
  items: PriceItem[],
  labels: Map<string, string>,
): PriceTrend {
  const n = months.length;
  const byKey = new Map<string, PriceItem[]>();
  for (const it of items) byKey.set(it.key, [...(byKey.get(it.key) ?? []), it]);
  const salesOf = (list: PriceItem[]) => list.reduce((s, it) => s + it.sales.reduce((a, b) => a + b, 0), 0);
  const groups = [...byKey].sort((a, b) => salesOf(b[1]) - salesOf(a[1]));
  return {
    months,
    series: [
      { key: '__all', label: '전체', points: pricePoints(items, n) },
      ...groups.map(([key, list]) => ({ key, label: labels.get(key) ?? key, points: pricePoints(list, n) })),
    ],
  };
}
