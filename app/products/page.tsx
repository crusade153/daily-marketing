import { redirect } from 'next/navigation';

// 제품별 매출은 손익 분석(/hierarchy)의 '제품 목록' 보기로 합쳤다. 예전 주소·즐겨찾기용
export default function ProductsPage() {
  redirect('/hierarchy?view=product');
}
