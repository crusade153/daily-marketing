export type Scenario = 'mtd' | 'fcst' | 'prev';

export const SCENARIO_LABEL: Record<Scenario, string> = {
  mtd: '당월 누계',
  fcst: '당월 예상',
  prev: '전월 실적',
};

/** 원가 산출 방식: 품목 3개월 단위원가 / 계층 원가율 대체 / 원가 없음 */
export type CostMethod = 'unit' | 'rate' | 'none';

/**
 * 제품계층 LV1~LV4 (SD_MARA PRDHA_1·2·3, PRDHA). 코드 길이 3·8·13·18.
 * 하위 레벨이 지정되지 않은 품목은 상위 코드가 반복되므로, 이름을 "상위명 · 미지정"으로 바꿔 둔다.
 */
export interface Hierarchy {
  l1: string;
  l1t: string;
  l2: string;
  l2t: string;
  l3: string;
  l3t: string;
  l4: string;
  l4t: string;
}

/** BigQuery 품목별 집계 원천 */
export interface MaterialFact extends Hierarchy {
  matnr: string;
  name: string;
  curSales: number;
  curQty: number;
  prevSales: number;
  prevQty: number;
  prevCogs: number;
  costQty: number; // 3개월 수량 (EA)
  costSales: number; // 3개월 매출
  costCogs: number; // 3개월 실제원가
}

/** BigQuery 품목별 마감월 실적 (올해 1월 ~ 전월). 월 키는 YYYYMM */
export interface MonthFact extends Hierarchy {
  matnr: string;
  name: string;
  sales: Record<string, number>;
  qty: Record<string, number>; // 판매수량 (EA)
  cogs: Record<string, number>; // CO-PA 실제원가
}

export interface DailyFact {
  date: string; // YYYYMMDD
  l1t: string;
  sales: number;
}

/** 손익 금액 묶음 (+ 판매수량 EA — 제품 단위에서만 단가로 의미가 있다) */
export interface Amounts {
  sales: number;
  qty: number;
  cogs: number;
  incentive: number; // 장려금
  general: number; // 일반비
}

export interface ProductMap {
  matnr: string;
  name: string;
  cm1: string;
  cm2: string;
  cm3: string;
  category: string;
  owner: string;
}

/** 장려금·일반비 수기 입력 (제품계층 LV1, 월 전체 금액, 원) */
export interface ManualInput {
  ym: string;
  l1: string;
  l1t: string;
  incentive: number;
  general: number;
  updatedAt: string;
  updatedBy: string;
}

/** 품목 행의 분석 축 */
export interface RowDims extends Hierarchy {
  matnr: string;
  name: string;
  cm1: string;
  cm2: string;
  cm3: string;
  category: string;
  owner: string;
}

/** 한 달치 품목 손익 행 (마감월 실적 또는 당월 예상) */
export interface MonthRow extends RowDims {
  amt: Amounts;
}

/** 화면에서 쓰는 품목 행 (분석 축 + 시나리오별 금액) */
export interface MaterialRow extends RowDims {
  costMethod: CostMethod;
  mtd: Amounts;
  fcst: Amounts;
  prev: Amounts;
}

export interface DashboardData {
  curYm: string;
  prevYm: string;
  costYms: string[];
  dataDate: string | null;
  progress: { elapsed: number; daysInMonth: number; rate: number };
  rows: MaterialRow[];
  coverage: { unitSales: number; rateSales: number; noneSales: number };
  inputStatus: { l1Total: number; curFilled: number; prevFilled: number };
  storage: 'sheets' | 'local';
}
