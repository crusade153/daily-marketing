import { redirect } from 'next/navigation';
import LedgerPnl from '@/components/ledger-pnl';
import MonthStepper from '@/components/month-stepper';
import { getLedger } from '@/lib/data';
import { monthLinks, selectMonth } from '@/lib/month';
import { getSession } from '@/lib/session';
import { findUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 시범 기능: ADMIN만. proxy가 쿠키 역할로 1차로 막고, 여기서는 시트 기준으로 다시 확인한다
  const session = await getSession();
  const me = session && (await findUser(session.id));
  if (me?.role !== 'ADMIN') redirect('/');
  const sel = selectMonth((await searchParams).ym);
  const data = await getLedger(sel.today);
  return (
    <div className="il-page">
      <div className="page-intro">
        <h1>실적 손익계산서 <span className="il-beta">SAP · 관리자 시범</span></h1>
        <MonthStepper {...monthLinks('/admin/pnl', sel)} />
        <p>장려금·일반비 수기 입력 없이 SAP 실적(CO-PA 매출·원가, 회계원장 장려금·판관비)만으로 계산한 회사 전체 손익입니다. 관리자에게만 보입니다.</p>
      </div>
      <LedgerPnl data={data} />
    </div>
  );
}
