// 손익 화면(제품별·채널별)의 ABCD 등급. ABCD 등급관리 화면의 기본 기준과 같다:
//   X = 순매출, 기준 5천만원 이상 = 규모↑ / Y = 영업이익, 0 이상 = 손익+
//   기준이 고정 금액이라 범위·채널을 좁혀도 같은 금액이면 같은 등급이다.
//   제품별은 제품 하나(전 채널 합), 채널별은 제품 × 채널 하나를 등급 단위로 본다.
import { metrics, ORPHAN_NAME } from './pnl.ts';
import { gradeTrend, quadrantOf, shiftLabel, type Quadrant, type Trend } from './segment.ts';
import type { Amounts, MaterialRow, Scenario } from './types';

export const GRADE_NET_CUT = 5e7;

/** 실적(매출·수량·원가)이 하나도 없으면 null */
export function gradeOf(a: Amounts): Quadrant | null {
  if (!a.sales && !a.qty && !a.cogs) return null;
  const m = metrics(a);
  return quadrantOf(m.net, m.op, GRADE_NET_CUT, 0);
}

type Period = Scenario | 'prev2';

/** 화면 기간에 맞는 등급 비교: 누계·예상은 전월 실적 → 당월 예상, 전월 실적은 전전월 → 전월 (누계는 월말 예상으로 판정) */
export const gradePair = (s: Scenario): { from: Period; to: Period } => (s === 'prev' ? { from: 'prev2', to: 'prev' } : { from: 'prev', to: 'fcst' });

export interface GradeChange {
  key: string;
  matnr: string;
  name: string;
  ch: string | null; // 채널별 단위일 때 채널 코드
  cht: string | null;
  from: Quadrant | null;
  to: Quadrant | null;
  trend: Trend;
  shift: string | null; // 적자 전환 · 흑자 전환 · 규모 축소 · 규모 확대
  opFrom: number;
  opTo: number;
  netFrom: number;
  netTo: number;
}

export function changeOf(from: Amounts, to: Amounts): Pick<GradeChange, 'from' | 'to' | 'trend' | 'shift' | 'opFrom' | 'opTo' | 'netFrom' | 'netTo'> | null {
  const gf = gradeOf(from);
  const gt = gradeOf(to);
  const trend = gradeTrend(gf, gt);
  if (!trend) return null;
  const mf = metrics(from);
  const mt = metrics(to);
  return { from: gf, to: gt, trend, shift: gf && gt ? shiftLabel(gf, gt) : null, opFrom: mf.op, opTo: mt.op, netFrom: mf.net, netTo: mt.net };
}

const add = (a: Amounts, b: Amounts): Amounts => ({
  sales: a.sales + b.sales,
  qty: a.qty + b.qty,
  cogs: a.cogs + b.cogs,
  incentive: a.incentive + b.incentive,
  general: a.general + b.general,
});

export const gradeUnitKey = (r: Pick<MaterialRow, 'matnr' | 'ch'>, byChannel: boolean) => (byChannel ? `${r.matnr}|${r.ch}` : r.matnr);

/** 등급 단위별 두 기간 비교. 두 기간 모두 실적이 없는 단위는 뺀다 */
export function gradeChanges(rows: MaterialRow[], byChannel: boolean, from: Period, to: Period): GradeChange[] {
  const map = new Map<string, { r: MaterialRow; from: Amounts; to: Amounts }>();
  for (const r of rows) {
    if (r.name === ORPHAN_NAME) continue;
    const key = gradeUnitKey(r, byChannel);
    const u = map.get(key);
    if (u) {
      u.from = add(u.from, r[from]);
      u.to = add(u.to, r[to]);
    } else map.set(key, { r, from: r[from], to: r[to] });
  }
  const out: GradeChange[] = [];
  for (const [key, u] of map) {
    const c = changeOf(u.from, u.to);
    if (!c) continue;
    out.push({ key, matnr: u.r.matnr, name: u.r.name, ch: byChannel ? u.r.ch : null, cht: byChannel ? u.r.cht : null, ...c });
  }
  return out;
}
