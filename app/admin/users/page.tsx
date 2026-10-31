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
        <p>앱에 들어올 수 있는 계정을 관리합니다. STATUS를 PENDING으로 바꾸거나 계정을 삭제하면 5분 안에 접속이 끊깁니다. 내용은 권한관리 구글 시트에 바로 저장되며, 시트에서 직접 고쳐도 됩니다.</p>
      </div>
      <UserAdmin users={views} autoApprove={autoApprove} me={me.loginId} />
    </div>
  );
}
