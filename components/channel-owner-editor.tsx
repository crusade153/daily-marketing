'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveChannelOwners } from '@/actions/input-actions';
import { mil } from '@/lib/format';

export interface ChannelRow {
  ch: string;
  cht: string;
  sales: number; // 당월 예상 + 전월 매출
  rep: string;
  updatedAt: string;
  updatedBy: string;
}

function readLocal(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

/** 고객그룹3(채널)별 영업담당자 편집. 채널당 한 명 — 채널별 손익 분석의 첫 단계가 된다 */
export default function ChannelOwnerEditor({ channels }: { channels: ChannelRow[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(readLocal('dm-user') ?? '');
  }, []);

  const valueOf = (c: ChannelRow) => edits[c.ch] ?? c.rep;
  const changed = channels.filter((c) => valueOf(c).trim() !== c.rep);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => [c.ch, c.cht, c.rep, edits[c.ch] ?? ''].some((v) => v.toLowerCase().includes(q)));
  }, [channels, query, edits]);

  const save = () =>
    start(async () => {
      const res = await saveChannelOwners({ user, entries: changed.map((c) => ({ ch: c.ch, cht: c.cht, rep: valueOf(c).trim() })) });
      if (res.ok) {
        setMsg({ ok: true, text: `${res.updated + res.appended}개 채널을 저장했습니다.` });
        setEdits({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  return (
    <div className="card lo-card">
      <div className="lo-head">
        <div>
          <h2>채널별 영업담당자</h2>
          <p>고객그룹3마다 영업담당자 한 명을 적습니다. 채널별 손익 분석이 영업담당자 › 채널 › 제품 순으로 묶입니다. 비워 두면 ‘(미매핑)’입니다.</p>
        </div>
      </div>
      <div className="lo-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="채널·영업담당자 검색" aria-label="채널 검색" className="lo-search" />
        <label className="lo-user">
          <span>작성자</span>
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              writeLocal('dm-user', e.target.value);
            }}
            placeholder="이름"
          />
        </label>
        <div className="lo-save">
          {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
          <button type="button" className="lo-save-button" disabled={!changed.length || pending} onClick={save}>
            {pending ? '저장 중…' : changed.length ? `${changed.length}개 저장` : '변경 없음'}
          </button>
        </div>
      </div>
      <div className="data-scroll lo-scroll">
        <table className="dtable lo-table">
          <thead>
            <tr>
              <th className="text-left">채널(고객그룹3)</th>
              <th className="text-left">코드</th>
              <th className="num">당월 예상+전월 매출</th>
              <th className="text-left">영업담당자</th>
              <th className="text-left">최근 수정</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const v = valueOf(c);
              return (
                <tr key={c.ch} className={v.trim() !== c.rep ? 'is-dirty' : ''}>
                  <td className="lo-line" data-label="채널">{c.cht}</td>
                  <td className="text-muted" data-label="코드">{c.ch}</td>
                  <td className="num" data-label="매출(백만원)">{mil(c.sales)}</td>
                  <td data-label="영업담당자">
                    <input value={v} onChange={(e) => setEdits((p) => ({ ...p, [c.ch]: e.target.value }))} placeholder="이름" aria-label={`${c.cht} 영업담당자`} />
                  </td>
                  <td className="lo-meta" data-label="최근 수정">{c.updatedAt ? `${c.updatedAt.slice(5, 16)} · ${c.updatedBy}` : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
