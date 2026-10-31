'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveUser, createUser, editUser, removeUser, saveAutoApprove, type AdminResult } from '@/actions/admin-actions';
import type { Role } from '@/lib/auth';

export interface UserView {
  loginId: string;
  name: string;
  companyId: string;
  role: Role;
  status: 'ACTIVE' | 'PENDING';
}

interface Draft {
  companyId: string;
  name: string;
  loginId: string;
  role: string;
  status: string;
  password: string;
}

const EMPTY: Draft = { companyId: '', name: '', loginId: '', role: 'USER', status: 'ACTIVE', password: '' };

function Select({ value, options, onChange, disabled, label }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
const ROLE_OPTIONS = ['USER', 'ADMIN'];
const STATUS_OPTIONS = ['ACTIVE', 'PENDING'];

/** 회원 목록·추가·수정·삭제와 자동승인 스위치. 저장은 바로 권한관리 시트에 반영된다 */
export default function UserAdmin({ users, autoApprove, me }: { users: UserView[]; autoApprove: boolean; me: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ target: string; draft: Draft } | null>(null);
  const [auto, setAuto] = useState(autoApprove);

  const isMe = (id: string) => id.toLowerCase() === me.toLowerCase();
  const waiting = users.filter((u) => u.status !== 'ACTIVE').length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? users.filter((u) => [u.loginId, u.name, u.companyId].some((v) => v.toLowerCase().includes(q))) : users;
    return [...list].sort((a, b) => Number(a.status === 'ACTIVE') - Number(b.status === 'ACTIVE')); // PENDING을 위로
  }, [users, query]);

  const act = (call: () => Promise<AdminResult>, done: string, after?: () => void) =>
    start(async () => {
      const res = await call();
      if (res.ok) {
        setMsg({ ok: true, text: done });
        after?.();
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  const toggleAuto = () => {
    const next = !auto;
    start(async () => {
      const res = await saveAutoApprove(next);
      if (res.ok) {
        setAuto(next);
        setMsg({ ok: true, text: next ? '자동승인을 켰습니다. 새 가입자는 바로 ACTIVE가 됩니다.' : '자동승인을 껐습니다. 새 가입자는 PENDING으로 들어옵니다.' });
      } else setMsg({ ok: false, text: res.error });
    });
  };

  const field = (d: Draft, set: (d: Draft) => void, key: keyof Draft, label: string, type = 'text') => (
    <input
      type={type}
      value={d[key]}
      onChange={(e) => set({ ...d, [key]: e.target.value })}
      placeholder={label}
      aria-label={label}
      autoComplete={type === 'password' ? 'new-password' : 'off'}
    />
  );

  return (
    <div className="card lo-card">
      <div className="lo-head ua-head">
        <div>
          <h2>계정 {users.length}개{waiting > 0 && <span className="ua-waiting">승인 대기 {waiting}</span>}</h2>
          <p>STATUS가 ACTIVE인 계정만 로그인할 수 있습니다. 승인 대기(PENDING) 계정은 위에 모아 보여 줍니다. 비밀번호는 권한관리 시트 PW 칸에서 확인할 수 있습니다.</p>
        </div>
        <button type="button" role="switch" aria-checked={auto} className="ua-switch" onClick={toggleAuto} disabled={pending}>
          <span className="ua-track" aria-hidden="true"><span /></span>
          <span>
            자동승인 <b>{auto ? 'ON' : 'OFF'}</b>
            <small>{auto ? '가입하면 바로 로그인 가능' : '관리자가 승인해야 로그인 가능'}</small>
          </span>
        </button>
      </div>
      <div className="lo-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·아이디 검색" aria-label="계정 검색" className="lo-search" />
        <div className="lo-save">
          {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'} role="status">{msg.text}</span>}
          <button type="button" className="lo-save-button" disabled={pending || !!adding} onClick={() => { setAdding({ ...EMPTY }); setEditing(null); setMsg(null); }}>
            계정 추가
          </button>
        </div>
      </div>
      <div className="data-scroll lo-scroll">
        <table className="dtable lo-table ua-table">
          <thead>
            <tr>
              <th className="text-left">이름</th>
              <th className="text-left">회사 아이디</th>
              <th className="text-left">로그인 아이디</th>
              <th className="text-left">역할</th>
              <th className="text-left">상태</th>
              <th className="text-left">새 비밀번호</th>
              <th className="text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="is-dirty">
                <td data-label="이름">{field(adding, setAdding, 'name', '이름')}</td>
                <td data-label="회사 아이디">{field(adding, setAdding, 'companyId', '회사 아이디')}</td>
                <td data-label="로그인 아이디">{field(adding, setAdding, 'loginId', '로그인 아이디')}</td>
                <td data-label="역할"><Select value={adding.role} options={ROLE_OPTIONS} onChange={(role) => setAdding({ ...adding, role })} label="역할" /></td>
                <td data-label="상태"><Select value={adding.status} options={STATUS_OPTIONS} onChange={(status) => setAdding({ ...adding, status })} label="상태" /></td>
                <td data-label="비밀번호">{field(adding, setAdding, 'password', '비밀번호 6자 이상', 'password')}</td>
                <td className="ua-actions">
                  <button type="button" className="ua-primary" disabled={pending} onClick={() => act(() => createUser(adding), `${adding.loginId} 계정을 추가했습니다.`, () => setAdding(null))}>
                    추가
                  </button>
                  <button type="button" disabled={pending} onClick={() => setAdding(null)}>취소</button>
                </td>
              </tr>
            )}
            {shown.map((u) => {
              if (editing?.target === u.loginId) {
                const d = editing.draft;
                const set = (draft: Draft) => setEditing({ target: u.loginId, draft });
                return (
                  <tr key={u.loginId} className="is-dirty">
                    <td data-label="이름">{field(d, set, 'name', '이름')}</td>
                    <td data-label="회사 아이디">{field(d, set, 'companyId', '회사 아이디')}</td>
                    <td data-label="로그인 아이디">
                      {isMe(u.loginId) ? <span className="ua-id">{u.loginId}</span> : field(d, set, 'loginId', '로그인 아이디')}
                    </td>
                    <td data-label="역할">
                      <Select value={d.role} options={ROLE_OPTIONS} onChange={(role) => set({ ...d, role })} disabled={isMe(u.loginId)} label="역할" />
                    </td>
                    <td data-label="상태">
                      <Select value={d.status} options={STATUS_OPTIONS} onChange={(status) => set({ ...d, status })} disabled={isMe(u.loginId)} label="상태" />
                    </td>
                    <td data-label="새 비밀번호">{field(d, set, 'password', '바꿀 때만 입력', 'password')}</td>
                    <td className="ua-actions">
                      <button type="button" className="ua-primary" disabled={pending} onClick={() => act(() => editUser({ target: u.loginId, ...d }), `${d.loginId} 계정을 저장했습니다.`, () => setEditing(null))}>
                        저장
                      </button>
                      <button type="button" disabled={pending} onClick={() => setEditing(null)}>취소</button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={u.loginId}>
                  <td className="lo-line" data-label="이름">{u.name || '-'}{isMe(u.loginId) && <span className="ua-me">나</span>}</td>
                  <td data-label="회사 아이디">{u.companyId || '-'}</td>
                  <td data-label="로그인 아이디"><span className="ua-id">{u.loginId}</span></td>
                  <td data-label="역할"><span className={`ua-role ua-role-${u.role}`}>{u.role}</span></td>
                  <td data-label="상태"><span className={`ua-role ua-status-${u.status}`}>{u.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING · 승인 대기'}</span></td>
                  <td data-label="비밀번호" className="text-muted">••••••</td>
                  <td className="ua-actions">
                    {u.status !== 'ACTIVE' && (
                      <button type="button" className="ua-primary" disabled={pending} onClick={() => act(() => approveUser(u.loginId), `${u.loginId} 계정을 승인했습니다.`)}>
                        승인
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setEditing({ target: u.loginId, draft: { companyId: u.companyId, name: u.name, loginId: u.loginId, role: u.role, status: u.status, password: '' } });
                        setAdding(null);
                        setMsg(null);
                      }}
                    >
                      수정
                    </button>
                    {!isMe(u.loginId) && (
                      <button
                        type="button"
                        className="ua-danger"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`${u.name || u.loginId}(${u.loginId}) 계정을 삭제할까요? 시트에서 행이 지워집니다.`))
                            act(() => removeUser(u.loginId), `${u.loginId} 계정을 삭제했습니다.`);
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && !adding && (
              <tr>
                <td colSpan={7} className="text-center text-muted">계정이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
