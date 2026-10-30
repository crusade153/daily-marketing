'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveLineOwners } from '@/actions/input-actions';
import { mil } from '@/lib/format';

export interface LineSummary {
  line: string;
  products: number;
  sales: number; // 당월 예상 매출
  mark: string; // 시트 CM 표시 (가장 많은 것, 섞여 있으면 '외 n')
  markKey: string; // 일괄 입력용 대표 표시 (CM1·CM2·CM3·기타·(미매핑))
  sheetOwner: string; // 시트 담당자 (가장 많은 것)
  cm: string;
  pm: string;
  updatedAt: string;
  updatedBy: string;
}

type Edit = { cm: string; pm: string };

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

/** 제품라인별 CM·PM 이름 편집. 빈칸이면 시트 표시(CM1~CM3)·담당자 열을 그대로 쓴다. */
export default function LineOwnerEditor({ lines, unlined, curLabel }: { lines: LineSummary[]; unlined: number; curLabel: string }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('');
  const [bulkMark, setBulkMark] = useState('');
  const [bulkName, setBulkName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 작성자 이름은 장려금 입력 화면과 같은 브라우저 저장값을 쓴다 (마운트 후에만 읽을 수 있음)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(readLocal('dm-user') ?? '');
  }, []);

  const marks = useMemo(() => [...new Set(lines.map((l) => l.markKey))].sort(), [lines]);
  const valueOf = (l: LineSummary): Edit => edits[l.line] ?? { cm: l.cm, pm: l.pm };
  const changed = lines.filter((l) => {
    const v = valueOf(l);
    return v.cm.trim() !== l.cm || v.pm.trim() !== l.pm;
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) =>
      [l.line, l.mark, l.sheetOwner, l.cm, l.pm, edits[l.line]?.cm ?? '', edits[l.line]?.pm ?? ''].some((v) => v.toLowerCase().includes(q)),
    );
  }, [lines, query, edits]);

  const set = (l: LineSummary, k: keyof Edit, v: string) => setEdits((p) => ({ ...p, [l.line]: { ...valueOf(l), [k]: v } }));

  const applyBulk = () => {
    const name = bulkName.trim();
    if (!bulkMark || !name) return;
    const targets = lines.filter((l) => l.markKey === bulkMark);
    setEdits((p) => {
      const next = { ...p };
      for (const l of targets) next[l.line] = { ...(p[l.line] ?? { cm: l.cm, pm: l.pm }), cm: name };
      return next;
    });
    setMsg({ ok: true, text: `${bulkMark} 표시 제품라인 ${targets.length}개에 CM명을 채웠습니다. 저장해야 반영됩니다.` });
  };

  const save = () =>
    start(async () => {
      const res = await saveLineOwners({
        user,
        entries: changed.map((l) => ({ line: l.line, cm: valueOf(l).cm.trim(), pm: valueOf(l).pm.trim() })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `${res.updated + res.appended}개 제품라인을 저장했습니다.` });
        setEdits({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  return (
    <div className="card lo-card">
      <div className="lo-head">
        <div>
          <h2>제품라인별 CM·PM 담당자</h2>
          <p>
            이름을 적으면 손익 분석·월별 추이·ABCD 등급의 CM·PM이 이 이름으로 바뀝니다. 비워 두면 시트의 CM 표시(CM1~CM3)와 담당자 열을 씁니다.
            {unlined > 0 && ` 제품라인(카테고리)이 비어 있는 품목 ${unlined.toLocaleString()}개는 시트에서 제품라인을 먼저 채워야 합니다.`}
          </p>
        </div>
      </div>
      <div className="lo-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제품라인·CM·PM 검색" aria-label="제품라인 검색" className="lo-search" />
        <div className="lo-bulk" role="group" aria-label="CM 일괄 입력">
          <span>CM 일괄</span>
          <select value={bulkMark} onChange={(e) => setBulkMark(e.target.value)} aria-label="시트 CM 표시">
            <option value="">시트 표시 선택</option>
            {marks.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input value={bulkName} onChange={(e) => setBulkName(e.target.value)} placeholder="CM 이름" aria-label="일괄 적용할 CM 이름" />
          <button type="button" onClick={applyBulk} disabled={!bulkMark || !bulkName.trim()}>채우기</button>
        </div>
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
              <th className="text-left">제품라인</th>
              <th className="num">제품 수</th>
              <th className="num">{curLabel} 매출</th>
              <th className="text-left">시트 CM</th>
              <th className="text-left">시트 담당자</th>
              <th className="text-left">CM명</th>
              <th className="text-left">PM명</th>
              <th className="text-left">최근 수정</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const v = valueOf(l);
              const dirty = v.cm.trim() !== l.cm || v.pm.trim() !== l.pm;
              return (
                <tr key={l.line} className={dirty ? 'is-dirty' : ''}>
                  <td className="lo-line" data-label="제품라인">{l.line}</td>
                  <td className="num" data-label="제품 수">{l.products.toLocaleString()}</td>
                  <td className="num" data-label="매출(백만원)">{mil(l.sales)}</td>
                  <td className="text-muted" data-label="시트 CM">{l.mark}</td>
                  <td className="text-muted" data-label="시트 담당자">{l.sheetOwner || '-'}</td>
                  <td data-label="CM명">
                    <input value={v.cm} onChange={(e) => set(l, 'cm', e.target.value)} placeholder={l.markKey} aria-label={`${l.line} CM명`} />
                  </td>
                  <td data-label="PM명">
                    <input value={v.pm} onChange={(e) => set(l, 'pm', e.target.value)} placeholder={l.sheetOwner || '이름'} aria-label={`${l.line} PM명`} />
                  </td>
                  <td className="lo-meta" data-label="최근 수정">{l.updatedAt ? `${l.updatedAt.slice(5, 16)} · ${l.updatedBy}` : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
