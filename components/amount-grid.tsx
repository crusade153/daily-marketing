'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveChannelGenerals, savePlans, saveSgIncentives, type SaveResult } from '@/actions/input-actions';
import { mil, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';

/** 입력 행 하나: 영업그룹 / 고객그룹3 / 제품계층 LV3 */
export interface AmountItem {
  key: string;
  label: string;
  /** 월별 참고 매출 (원) */
  ref: Record<string, number>;
  /** 머리 행으로 묶을 상위 이름 (판매계획: [브랜드, LV2]) */
  groups?: string[];
}

export interface SavedAmount {
  ym: string;
  key: string;
  amount: number;
  updatedAt: string;
  updatedBy: string;
}

export type AmountKind = 'sg' | 'ch' | 'plan';
const SAVE: Record<AmountKind, (input: unknown) => Promise<SaveResult>> = { sg: saveSgIncentives, ch: saveChannelGenerals, plan: savePlans };

const UNITS = [
  { v: 1, label: '원' },
  { v: 1e3, label: '천원' },
  { v: 1e6, label: '백만원' },
];
const fmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const parse = (s: string): number | null => {
  const t = s.replaceAll(',', '').replaceAll(' ', '').trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

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
  } catch {
    /* 저장소를 못 쓰면 기억만 못 한다 */
  }
}

/**
 * 월 × 행 금액 입력표 (한 칸 = 금액 하나). 장려금(영업그룹)·일반비(고객그룹3)·판매계획(LV3)이 같은 화면을 쓴다.
 * 입력 단위(원·천원·백만원)와 작성자는 브라우저에 기억한다. 엑셀에서 한 열을 붙여 넣으면 아래로 채운다.
 */
export default function AmountGrid({
  kind,
  rowName,
  fieldLabel,
  refLabel,
  items,
  saved,
  months,
  initialYm,
}: {
  kind: AmountKind;
  rowName: string;
  fieldLabel: string;
  /** 참고 매출 열 이름 (예: '누계 매출', '최근 3개월 평균 매출') */
  refLabel: string;
  items: AmountItem[];
  saved: SavedAmount[];
  /** 입력할 수 있는 달 */
  months: string[];
  initialYm: string;
}) {
  const router = useRouter();
  const [ym, setYm] = useState(months.includes(initialYm) ? initialYm : months[0]);
  const [unit, setUnit] = useState(1e6);
  const [user, setUser] = useState('');
  const [buf, setBuf] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [pending, start] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  // 브라우저 저장값(단위·작성자)은 마운트 후에만 읽을 수 있다 — 서버 렌더와 첫 화면을 맞추려고 effect에서 반영
  useEffect(() => {
    const u = Number(readLocal('dm-unit'));
    /* eslint-disable react-hooks/set-state-in-effect */
    if (UNITS.some((x) => x.v === u)) setUnit(u);
    setUser(readLocal('dm-user') ?? '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const base = useMemo(() => {
    const m = new Map<string, SavedAmount>();
    for (const s of saved) if (s.ym === ym) m.set(s.key, s);
    return m;
  }, [saved, ym]);
  const filledBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of saved) if (s.amount) m.set(s.ym, (m.get(s.ym) ?? 0) + 1);
    return m;
  }, [saved]);

  const baseValue = useCallback((k: string) => base.get(k)?.amount ?? 0, [base]);
  /** 화면 단위 → 원 */
  const valueOf = useCallback(
    (k: string): number | null => {
      const s = buf[k];
      if (s === undefined) return baseValue(k);
      const n = parse(s);
      return n == null ? null : Math.round(n * unit);
    },
    [buf, baseValue, unit],
  );
  const { dirty, invalid } = useMemo(() => {
    const dirty: string[] = [];
    let invalid = 0;
    for (const k of Object.keys(buf)) {
      const v = valueOf(k);
      if (v == null) invalid++;
      else if (v !== Math.round(baseValue(k))) dirty.push(k);
    }
    return { dirty, invalid };
  }, [buf, valueOf, baseValue]);

  // 저장 안 한 변경이 있으면 페이지 이탈 경고
  useEffect(() => {
    if (!dirty.length) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty.length]);

  const save = useCallback(() => {
    if (!dirty.length || invalid || pending) return;
    const byKey = new Map(items.map((it) => [it.key, it]));
    start(async () => {
      const res = await SAVE[kind]({ ym, user, entries: dirty.map((k) => ({ key: k, name: byKey.get(k)?.label ?? '', amount: valueOf(k) ?? 0 })) });
      if (res.ok) {
        setMsg({ ok: true, text: `저장했습니다. 수정 ${res.updated}건 · 신규 ${res.appended}건` });
        setBuf({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }, [dirty, invalid, pending, items, kind, ym, user, valueOf, router]);

  // Ctrl+S 저장
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const switchMonth = (next: string) => {
    if (next === ym) return;
    if (dirty.length && !confirm('저장하지 않은 변경이 있습니다. 버리고 월을 바꿀까요?')) return;
    setBuf({});
    setMsg(null);
    setYm(next);
  };
  const switchUnit = (u: number) => {
    if (dirty.length && !confirm('단위를 바꾸면 저장하지 않은 입력이 지워집니다. 계속할까요?')) return;
    setBuf({});
    setUnit(u);
    writeLocal('dm-unit', String(u));
  };

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((it) => [it.label, it.key, ...(it.groups ?? [])].some((v) => v.toLowerCase().includes(q))) : items;
  const focusRow = (row: number) => tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${row}"]`)?.focus();
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number) => {
    const mv = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' || e.key === 'Enter' ? 1 : 0;
    if (!mv) return;
    e.preventDefault();
    focusRow(row + mv);
  };
  // 엑셀 한 열 붙여넣기: 이 칸부터 아래로
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    setBuf((prev) => {
      const next = { ...prev };
      lines.forEach((line, i) => {
        const it = shown[row + i];
        if (it) next[it.key] = line.split('\t')[0].trim();
      });
      return next;
    });
  };

  const total = shown.reduce((s, it) => ({ ref: s.ref + (it.ref[ym] ?? 0), amount: s.amount + (valueOf(it.key) ?? 0) }), { ref: 0, amount: 0 });
  const unitLabel = UNITS.find((u) => u.v === unit)?.label;
  // 상위 묶음이 바뀌는 행 앞에 머리 행
  const heads = shown.map((it, i) => (it.groups ?? []).map((g, d) => i === 0 || (shown[i - 1].groups ?? []).slice(0, d + 1).join('|') !== (it.groups ?? []).slice(0, d + 1).join('|')));
  const cols = 6;

  return (
    <div className="input-workspace">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div className="flex flex-wrap overflow-hidden rounded-md border border-border" role="group" aria-label="입력 월">
          {months.map((m) => {
            const filled = filledBy.get(m) ?? 0;
            return (
              <button
                key={m}
                type="button"
                onClick={() => switchMonth(m)}
                aria-pressed={ym === m}
                className={`border-r border-border px-2.5 py-1.5 leading-tight last:border-r-0 ${ym === m ? 'bg-accent text-white' : 'hover:bg-surface-2'}`}
              >
                <span className="block font-semibold">{monthLabel(m)}</span>
                <span className={`block text-[10px] ${ym === m ? 'text-white/80' : filled ? 'text-pos' : 'text-muted'}`}>{filled ? `${filled}개` : '미입력'}</span>
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">입력 단위</span>
          <select value={unit} onChange={(e) => switchUnit(Number(e.target.value))} className="rounded-md border border-border bg-surface px-2 py-1.5">
            {UNITS.map((u) => (
              <option key={u.v} value={u.v}>{u.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">찾기</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-32 rounded-md border border-border bg-surface px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">작성자</span>
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              writeLocal('dm-user', e.target.value);
            }}
            className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
          />
        </label>
        <div className="ml-auto flex items-center gap-3">
          {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
          {invalid > 0 && <span className="text-neg">숫자가 아닌 칸 {invalid}개</span>}
          <button type="button" onClick={save} disabled={!dirty.length || invalid > 0 || pending} className="rounded-md bg-accent px-4 py-1.5 font-semibold text-white disabled:opacity-40" title="Ctrl+S">
            {pending ? '저장 중…' : `저장${dirty.length ? ` (${dirty.length}건)` : ''}`}
          </button>
        </div>
      </div>
      <div className="card data-scroll">
        <table className="dtable" ref={tableRef}>
          <thead>
            <tr>
              <th className="text-left">{rowName}</th>
              <th className="text-left">코드</th>
              <th className="num">{refLabel} (백만원)</th>
              <th className="num">{fieldLabel} ({unitLabel})</th>
              <th className="num" title={`${fieldLabel} ÷ ${refLabel}`}>비율</th>
              <th className="text-left">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td colSpan={2}>합계 ({shown.length.toLocaleString()}개)</td>
              <td className="num">{mil(total.ref)}</td>
              <td className="num">{fmt.format(total.amount / unit)}</td>
              <td className="num">{pct(total.ref ? total.amount / total.ref : null)}</td>
              <td />
            </tr>
            {shown.map((it, r) => {
              const v = valueOf(it.key);
              const b = baseValue(it.key);
              const sv = base.get(it.key);
              const ref = it.ref[ym] ?? 0;
              return (
                <Fragment key={it.key}>
                  {(it.groups ?? []).map((g, d) =>
                    heads[r][d] ? (
                      <tr key={`h${d}`} className={d === 0 ? 'subtotal' : ''}>
                        <td colSpan={cols} className={`font-semibold ${d > 0 ? 'text-[12.5px] text-muted' : ''}`} style={{ paddingLeft: 8 + d * 14 }}>{g || '(미지정)'}</td>
                      </tr>
                    ) : null,
                  )}
                  <tr>
                    <td style={{ paddingLeft: 8 + (it.groups?.length ?? 0) * 14 }}>{it.label}</td>
                    <td className="text-[11px] text-muted">{it.key}</td>
                    <td className="num text-muted">{mil(ref)}</td>
                    <td className="p-1">
                      <input
                        data-r={r}
                        inputMode="decimal"
                        aria-label={`${it.label} ${fieldLabel}`}
                        value={buf[it.key] ?? (b ? fmt.format(b / unit) : '')}
                        onChange={(e) => setBuf((p) => ({ ...p, [it.key]: e.target.value }))}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => onKeyDown(e, r)}
                        onPaste={(e) => onPaste(e, r)}
                        className={`num w-full min-w-[130px] rounded border px-2 py-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                          v == null ? 'border-neg bg-red-50' : 'border-border bg-[var(--input-bg)]'
                        }`}
                      />
                    </td>
                    <td className="num text-muted">{pct(ref && v != null && v ? v / ref : null)}</td>
                    <td className="whitespace-nowrap text-[11px] text-muted">{sv?.updatedAt ? `${sv.updatedAt.slice(5, 16)} ${sv.updatedBy}` : ''}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
