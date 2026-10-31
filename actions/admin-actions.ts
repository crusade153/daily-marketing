'use server';

import { z } from 'zod';
import { companyIdRule, loginIdRule, nameRule, passwordRule, roleRule, statusRule } from '@/lib/account-rules';
import { getSession } from '@/lib/session';
import { addUser, deleteUser, findUser, setAutoApprove, updateUser } from '@/lib/users';

// 회원관리(/admin/users) 액션. 쿠키 속 역할은 5분까지 늦을 수 있어 매번 시트에서 ADMIN인지 다시 확인한다.
// 관리자가 스스로를 잠그지 않도록 자기 계정의 역할·상태·아이디 변경과 삭제는 막는다.

export type AdminResult = { ok: true } | { ok: false; error: string };

const BAD_INPUT: AdminResult = { ok: false, error: '입력값을 확인하세요.' };
const err = (error: string): AdminResult => ({ ok: false, error });
const sameId = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const firstIssue = (e: z.ZodError) => err(e.issues[0]?.message ?? '입력값을 확인하세요.');

async function requireAdmin(): Promise<string | null> {
  const s = await getSession();
  if (!s) return null;
  const me = await findUser(s.id);
  return me?.role === 'ADMIN' ? me.loginId : null;
}

async function run(name: string, fn: (me: string) => Promise<AdminResult>): Promise<AdminResult> {
  try {
    const me = await requireAdmin();
    if (!me) return err('관리자만 할 수 있습니다.');
    return await fn(me);
  } catch (e) {
    console.error(name, e);
    return err(`처리 실패: ${(e as Error).message}`);
  }
}

const CreateInput = z.object({ companyId: companyIdRule, name: nameRule, loginId: loginIdRule, password: passwordRule, role: roleRule, status: statusRule });

export async function createUser(input: unknown): Promise<AdminResult> {
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  return run('createUser', async () => ((await addUser(parsed.data)) ? { ok: true } : err('이미 사용 중인 로그인 아이디입니다.')));
}

const EditInput = z.object({
  target: z.string().min(1).max(100), // 고치기 전 로그인 아이디
  companyId: companyIdRule,
  name: nameRule,
  loginId: loginIdRule,
  role: roleRule,
  status: statusRule,
  password: z.union([z.literal(''), passwordRule]), // 빈칸 = 그대로
});

export async function editUser(input: unknown): Promise<AdminResult> {
  const parsed = EditInput.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { target, password, ...patch } = parsed.data;
  return run('editUser', async (me) => {
    if (sameId(target, me)) {
      if (patch.role !== 'ADMIN') return err('내 계정의 역할은 바꿀 수 없습니다.');
      if (patch.status !== 'ACTIVE') return err('내 계정을 승인 대기로 바꿀 수 없습니다.');
      if (!sameId(patch.loginId, me)) return err('내 계정의 로그인 아이디는 바꿀 수 없습니다.');
    }
    const res = await updateUser(target, { ...patch, password: password || undefined });
    if (res === 'missing') return err('계정을 찾지 못했습니다. 새로고침 후 다시 시도하세요.');
    if (res === 'duplicate') return err('이미 사용 중인 로그인 아이디입니다.');
    return { ok: true };
  });
}

export async function approveUser(loginId: unknown): Promise<AdminResult> {
  const id = z.string().min(1).max(100).safeParse(loginId);
  if (!id.success) return BAD_INPUT;
  return run('approveUser', async () =>
    (await updateUser(id.data, { status: 'ACTIVE' })) === 'ok' ? { ok: true } : err('계정을 찾지 못했습니다.'),
  );
}

export async function removeUser(loginId: unknown): Promise<AdminResult> {
  const id = z.string().min(1).max(100).safeParse(loginId);
  if (!id.success) return BAD_INPUT;
  return run('removeUser', async (me) => {
    if (sameId(id.data, me)) return err('내 계정은 삭제할 수 없습니다.');
    return (await deleteUser(id.data)) ? { ok: true } : err('계정을 찾지 못했습니다.');
  });
}

export async function saveAutoApprove(on: unknown): Promise<AdminResult> {
  if (typeof on !== 'boolean') return BAD_INPUT;
  return run('saveAutoApprove', async () => {
    await setAutoApprove(on);
    return { ok: true };
  });
}
