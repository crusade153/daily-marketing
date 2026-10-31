import { z } from 'zod';
import { ROLES } from './auth';

// 가입 신청과 회원관리 화면이 같이 쓰는 계정 입력 규칙
export const companyIdRule = z.string().trim().min(1, '회사 아이디를 입력하세요.').max(100);
export const nameRule = z.string().trim().min(1, '이름을 입력하세요.').max(40);
export const loginIdRule = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{4,30}$/, '로그인 아이디는 영문·숫자·._- 4~30자입니다.');
export const passwordRule = z.string().min(6, '비밀번호는 6자 이상입니다.').max(100);
export const roleRule = z.enum(ROLES);
export const statusRule = z.enum(['ACTIVE', 'PENDING']);
