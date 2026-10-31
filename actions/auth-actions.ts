'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { companyIdRule, loginIdRule, nameRule, passwordRule } from '@/lib/account-rules';
import { AUTH_COOKIE, cookieOptions, safeNext, SESSION_DAYS, signSession } from '@/lib/auth';
import { addUser, checkPassword, findUser, getAutoApprove, isHashed, setPassword } from '@/lib/users';

// values: 가입 실패 때 입력값을 되돌려 준다 (폼 제출 뒤 입력칸이 비워지므로). 비밀번호는 담지 않는다
export type FormState = { error?: string; done?: boolean; approved?: boolean; values?: { companyId: string; name: string; loginId: string } } | undefined;

const fail = async (error: string): Promise<FormState> => {
  await new Promise((r) => setTimeout(r, 400)); // 비밀번호 대입을 느리게
  return { error };
};

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { error: '서버 설정 오류: AUTH_SECRET이 없습니다.' };
  const loginId = String(formData.get('loginId') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!loginId || !password) return { error: '아이디와 비밀번호를 입력하세요.' };

  let user;
  try {
    user = await findUser(loginId);
  } catch (e) {
    console.error('login', e);
    return { error: '계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
  if (!user || !(await checkPassword(password, user.pw))) return fail('아이디 또는 비밀번호가 맞지 않습니다.');
  if (user.status !== 'ACTIVE') return { error: '관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.' };

  // 예전에 해시로 저장된 비밀번호는 관리자가 볼 수 있도록 평문으로 되돌린다 (실패해도 로그인은 진행)
  if (isHashed(user.pw)) {
    try {
      await setPassword(user.rowNumber, password);
    } catch (e) {
      console.error('unhash', e);
    }
  }

  const now = Date.now();
  const exp = now + SESSION_DAYS * 86400_000;
  const token = await signSession({ id: user.loginId, name: user.name, role: user.role, exp, chk: now }, secret);
  (await cookies()).set(AUTH_COOKIE, token, cookieOptions(exp));
  redirect(safeNext(formData.get('next')));
}

const SignupInput = z
  .object({
    companyId: companyIdRule,
    name: nameRule,
    loginId: loginIdRule,
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: '비밀번호 확인이 일치하지 않습니다.' });

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(['companyId', 'name', 'loginId', 'password', 'confirm'].map((k) => [k, String(formData.get(k) ?? '')]));
  const values = { companyId: raw.companyId, name: raw.name, loginId: raw.loginId };
  const parsed = SignupInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '입력값을 확인하세요.', values };
  let approved: boolean;
  try {
    approved = await getAutoApprove();
    const added = await addUser({ ...parsed.data, role: 'USER', status: approved ? 'ACTIVE' : 'PENDING' });
    if (!added) return { error: '이미 사용 중인 로그인 아이디입니다.', values };
  } catch (e) {
    console.error('signup', e);
    return { error: '가입 신청을 저장하지 못했습니다. 잠시 후 다시 시도하세요.', values };
  }
  return { done: true, approved };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(AUTH_COOKIE);
  redirect('/login');
}
