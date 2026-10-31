import type { Metadata } from 'next';
import Nav from '@/components/nav';
import { getSession } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: '일일 매출·손익',
  description: '제품계층 기준 일일 매출, 예상 손익, 전월 실적 대시보드',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <Nav user={session && { name: session.name, role: session.role }} />
        <main id="main-content" className="app-main">{children}</main>
      </body>
    </html>
  );
}
