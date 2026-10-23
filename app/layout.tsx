import type { Metadata } from 'next';
import Nav from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: '일일 매출·손익',
  description: '제품계층 기준 일일 매출, 예상 손익, 전월 실적 대시보드',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <Nav />
        <main id="main-content" className="app-main">{children}</main>
      </body>
    </html>
  );
}
