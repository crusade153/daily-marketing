import { redirect } from 'next/navigation';
import InsightLab from '@/components/insight-lab';
import MonthStepper from '@/components/month-stepper';
import { getInsights } from '@/lib/data';
import { monthLinks, selectMonth } from '@/lib/month';
import { getSession } from '@/lib/session';
import { findUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 시범 기능: ADMIN만. proxy가 쿠키 역할로 1차로 막고, 여기서는 시트 기준으로 다시 확인한다
  const session = await getSession();
  const me = session && (await findUser(session.id));
  if (me?.role !== 'ADMIN') redirect('/');
  const sel = selectMonth((await searchParams).ym);
  const data = await getInsights(sel.today);
  return (
    <div className="il-page">
      <div className="page-intro">
        <h1>손익 인사이트 <span className="il-beta">관리자 시범</span></h1>
        <MonthStepper {...monthLinks('/admin/insights', sel)} />
        <p>영업이익이 왜 변했는지(가격·물량·믹스·원가·비용), 어떤 제품이 이익을 만들고 깎는지, 어디서 매출이 늘면서 수익성이 나빠졌는지를 봅니다. 관리자에게만 보입니다.</p>
      </div>
      <InsightLab data={data} />
    </div>
  );
}
