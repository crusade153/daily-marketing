import { redirect } from 'next/navigation';
import UserAdmin, { type UserView } from '@/components/user-admin';
import { getSession } from '@/lib/session';
import { findUser, getAutoApprove, listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  // proxy가 쿠키 역할로 1차로 막고, 여기서는 시트 기준으로 다시 확인한다
  const session = await getSession();
  const me = session && (await findUser(session.id));
  if (me?.role !== 'ADMIN') redirect('/');
  const [users, autoApprove] = await Promise.all([listUsers(), getAutoApprove()]);
  const views: UserView[] = users.map((u) => ({ loginId: u.loginId, name: u.name, companyId: u.companyId, role: u.role, status: u.status }));
  return (
    <div className="mapping-page">
      <div className="page-intro">
        <h1>회원관리</h1>
      </div>
      <UserAdmin users={views} autoApprove={autoApprove} me={me.loginId} />
    </div>
  );
}
