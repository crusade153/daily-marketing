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
  costQty: number; // 원가 기준 3개월 수량 (EA)
  costSales: number; // 원가 기준 3개월 매출
  costCogs: number; // 원가 기준 3개월 실제원가
}

/** BigQuery에서 받는 형태: 당월 전 4개월 월별 값. 원가 마감 여부를 보고 3개월을 골라 MaterialFact로 바꾼다 (pnl.ts applyCostBasis) */
export interface MaterialHist extends Omit<MaterialFact, 'costQty' | 'costSales' | 'costCogs'> {
  curCogs: number; // 당월 CO-PA 실제원가 (마감 여부 판단용)
  histQty: number[]; // Periods.histYms 순서 (오래된 달 → 전월)
  histSales: number[];
  histCogs: number[];
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
  /** CM1~CM3·기타: 소속 열에 ○ 등 표시 (빈칸·X는 미소속) */
  cm1: string;
  cm2: string;
  cm3: string;
  etc: string;
  category: string;
  owner: string;
}

/** 제품라인(카테고리)별 CM·PM 담당자 이름 — 대시보드 '제품 매핑'에서 수정.
 *  line이 '[CM1]'처럼 대괄호로 싸인 행은 CM 표시별 기본 이름 (제품라인이 비었거나 제품라인 이름이 없을 때) */
export interface LineOwner {
  line: string;
  cm: string;
  pm: string;
  updatedAt: string;
  updatedBy: string;
}

/** 고객그룹3(채널)별 영업담당자 — 채널당 한 명, 대시보드 '제품 매핑'에서 수정 */
export interface ChannelOwner {
  ch: string;
  cht: string;
  rep: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * 장려금·일반비 수기 입력: 고객그룹3(채널) × 월.
 * 장려금·일반비 고정비 = 월 전체 금액(원), 그 채널 제품 총매출 비중으로 배부. 변동비율 = 총매출 대비 %
 */
export interface ChannelInput {
  ym: string;
  ch: string; // KVGR3
  cht: string; // KVGR3_T
  incentive: number;
  general: number; // 일반비 고정비 (금액)
  rate: number; // 일반비 변동비율 (%, 예: 3.5 = 총매출의 3.5%)
  updatedAt: string;
  updatedBy: string;
}

/** 제품 × 고객그룹3 한 달 실적 (CO-PA) */
export interface ChannelFact {
  matnr: string;
  ch: string;
  cht: string;
  sales: number;
  qty: number;
  cogs: number; // CO-PA 실제원가 (마감월에만 의미)
}

/** 제품 × 월 목표 (구글 시트 target_product, 원) */
export interface Target {
  ym: string;
  matnr: string;
  sales: number;
  gp: number;
  op: number;
}

/** 손익 행의 분석 축: 제품 × 고객그룹3 한 행 */
export interface RowDims extends Hierarchy {
  matnr: string;
  name: string;
  /** CM 축: 시트 CM 표시 (CM1·CM2·CM3·기타·(미매핑)·(CM 중복)) */
  cm: string;
  /** cm과 같은 값 — 정렬 함수가 묶음 순서를 정할 때 쓴다 */
  cmMark: string;
  category: string;
  owner: string;
  ch: string;
  cht: string;
  /** 채널 영업담당자 */
  rep: string;
}

/** 한 달치 손익 행 (마감월 실적 또는 당월 예상) */
export interface MonthRow extends RowDims {
  amt: Amounts;
}

/** 화면에서 쓰는 손익 행 (분석 축 + 시나리오별 금액) */
export interface MaterialRow extends RowDims {
  costMethod: CostMethod;
  mtd: Amounts;
  fcst: Amounts;
  prev: Amounts;
  prev2: Amounts; // 전전월 실적 — '전월 실적' 보기의 비교 기준
}

/** 제품별 목표 [매출, GP, OP] */
export type TargetMap = Record<string, [number, number, number]>;

export interface DashboardData {
  curYm: string;
  prevYm: string;
  costYms: string[];
  /** 화면에 나오는 달 중 원가가 아직 마감되지 않은 달 (진행 중인 당월은 빼고) */
  costOpen: string[];
  /** 원가 결산 전이라 CO-PA 원가 대신 추정 원가를 넣은 지난달 */
  costEstYms: string[];
  dataDate: string | null;
  progress: { elapsed: number; daysInMonth: number; rate: number };
  rows: MaterialRow[];
  coverage: { unitSales: number; rateSales: number; noneSales: number };
  /** 비용 입력 현황: 매출 있는 채널 수, 당월·전월 입력한 채널 수 */
  inputStatus: { chTotal: number; curFilled: number; prevFilled: number };
  /** 수기 입력이 없어 장려금·일반비를 SAP 원장 실적으로 채운 달 (YYYYMM) */
  ledgerYms: string[];
  /** 당월·전월 제품 목표 */
  targets: { cur: TargetMap; prev: TargetMap };
  storage: 'sheets' | 'local';
}
