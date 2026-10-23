'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { appendUnmappedProducts } from '@/actions/input-actions';
import { mil } from '@/lib/format';

export interface UnmappedItem {
  matnr: string;
  name: string;
  l1t: string;
  l2t: string;
  curSales: number;
  prevSales: number;
  inSheet: boolean; // 시트에 행은 있으나 CM 등이 비어 있음
}

export default function UnmappedList({ items }: { items: UnmappedItem[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const toAdd = items.filter((i) => !i.inSheet);

  const copy = async () => {
    const tsv = items.map((i) => `${i.matnr}\t${i.name}`).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setMsg(`${items.length}개 품목(코드·제품명)을 복사했습니다.`);
    } catch {
      setMsg('클립보드 복사가 막혀 있습니다.');
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm">
        <h2 className="font-bold">매핑이 필요한 품목 {items.length}개</h2>
        <span className="text-xs text-muted">당월 + 전월 매출 큰 순</span>
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-xs text-muted">{msg}</span>}
          <button type="button" onClick={copy} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
            코드·제품명 복사
          </button>
          <button
            type="button"
            disabled={!toAdd.length || pending}
            onClick={() =>
              start(async () => {
                const res = await appendUnmappedProducts(toAdd.map((i) => ({ matnr: i.matnr, name: i.name })));
                setMsg(res.ok ? `시트에 ${res.appended}개 행을 추가했습니다. CM·카테고리·담당자를 채워 주세요.` : res.error);
                router.refresh();
              })
            }
            className="rounded-md bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-40"
          >
            {pending ? '추가 중…' : `시트에 ${toAdd.length}개 행 추가`}
          </button>
        </div>
      </div>
      <div className="data-scroll">
        <table className="dtable">
          <thead>
            <tr>
              <th className="text-left">제품코드</th>
              <th className="text-left">제품명</th>
              <th className="text-left">제품계층 LV1</th>
              <th className="text-left">제품계층 LV2</th>
              <th className="num">당월 매출(백만원)</th>
              <th className="num">전월 매출(백만원)</th>
              <th className="text-left">시트</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.matnr}>
                <td className="text-muted">{i.matnr}</td>
                <td>{i.name}</td>
                <td>{i.l1t}</td>
                <td>{i.l2t}</td>
                <td className="num">{mil(i.curSales)}</td>
                <td className="num">{mil(i.prevSales)}</td>
                <td className="text-xs text-muted">{i.inSheet ? '행 있음 · 값 비어 있음' : '없음'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
