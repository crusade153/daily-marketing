'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveChannelInputs } from '@/actions/input-actions';
import { mil, pct } from '@/lib/format';
import { monthLabel } from '@/lib/period';

/** 입력 행 = 고객그룹3(채널) */
export interface InputItem {
  key: string; // KVGR3
  label: string;
  sales: Record<string, number>; // 월별 참고 매출 (마감월 실적, 당월 누계)
}

/** 저장된 입력값 (월 × 행) */
export interface SavedInput {
  ym: string;
  key: string;
  incentive: number;
  general: number; // 일반비 고정비 (원)
  rate: number; // 일반비 변동비율 (%)
  updatedAt: string;
  updatedBy: string;
}

export interface InputMonth {
  ym: string;
  kind: 'actual' | 'fcst';
}

// 장려금·고정비는 금액(입력 단위 적용), 변동비율은 % 그대로
type Field = 'incentive' | 'general' | 'rate';
const FIELD_LABEL: Record<Field, string> = { incentive: '장려금', general: '일반비 고정비', rate: '일반비 변동비율' };
const FIELDS: Field[] = ['incentive', 'general', 'rate'];
const isAmount = (f: Field) => f !== 'rate';
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
const key = (l1: string, f: Field) => `${l1}|${f}`;

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

export default function InputGrid({
  items,
  inputs,
  months,
  curYm,
}: {
  items: InputItem[];
  inputs: SavedInput[];
  months: InputMonth[];
  curYm: string;
}) {
  const rowName = '고객그룹3';
  const router = useRouter();
  const [ym, setYm] = useState(curYm);
  const [unit, setUnit] = useState(1);
  const [user, setUser] = useState('');
  const [buf, setBuf] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  // 브라우저 저장값(단위·작성자)은 마운트 후에만 읽을 수 있다 — 서버 렌더와 첫 화면을 일치시키기 위해 effect에서 반영
  useEffect(() => {
    const u = Number(readLocal('dm-unit'));
    /* eslint-disable react-hooks/set-state-in-effect */
    if (UNITS.some((x) => x.v === u)) setUnit(u);
    setUser(readLocal('dm-user') ?? '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const base = useMemo(() => {
    const m = new Map<string, SavedInput>();
    for (const i of inputs) if (i.ym === ym) m.set(i.key, i);
    return m;
  }, [inputs, ym]);

  // 월별 입력 완료 LV1 수 (버튼 표시용)
  const filledBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inputs) if (i.incentive || i.general || i.rate) m.set(i.ym, (m.get(i.ym) ?? 0) + 1);
    return m;
  }, [inputs]);

  const baseValue = useCallback((l1: string, f: Field) => base.get(l1)?.[f] ?? 0, [base]);

  /** 화면 단위 → 원 */
  const valueOf = useCallback(
    (l1: string, f: Field): number | null => {
      const s = buf[key(l1, f)];
      if (s === undefined) return baseValue(l1, f);
      const n = parse(s);
      return n == null ? null : isAmount(f) ? n * unit : n;
    },
    [buf, baseValue, unit],
  );

  const { dirty, invalid } = useMemo(() => {
    const dirty = new Set<string>();
    let invalid = 0;
    for (const it of items) {
      for (const f of FIELDS) {
        const s = buf[key(it.key, f)];
        if (s === undefined) continue;
        const v = valueOf(it.key, f);
        if (v == null) invalid++;
        else if (Math.round(v) !== Math.round(baseValue(it.key, f))) dirty.add(it.key);
      }
    }
    return { dirty, invalid };
  }, [items, buf, valueOf, baseValue]);

  // 저장 안 한 변경이 있으면 페이지 이탈 경고
  useEffect(() => {
    if (!dirty.size) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty.size]);

  const save = useCallback(() => {
    if (!dirty.size || invalid || pending) return;
    const changed = items.filter((it) => dirty.has(it.key));
    start(async () => {
      const res = await saveChannelInputs({
        ym,
        user,
        entries: changed.map((it) => ({
          ch: it.key,
          cht: it.label,
          incentive: valueOf(it.key, 'incentive') ?? 0,
          general: valueOf(it.key, 'general') ?? 0,
          rate: valueOf(it.key, 'rate') ?? 0,
        })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `저장했습니다. 수정 ${res.updated}건 · 신규 ${res.appended}건` });
        setBuf({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }, [dirty, invalid, pending, items, valueOf, ym, user, router]);

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
    if (dirty.size && !confirm('저장하지 않은 변경이 있습니다. 버리고 월을 바꿀까요?')) return;
    setBuf({});
    setMsg(null);
    setYm(next);
  };

  const switchUnit = (u: number) => {
    if (dirty.size && !confirm('단위를 바꾸면 저장하지 않은 입력이 지워집니다. 계속할까요?')) return;
    setBuf({});
    setUnit(u);
    writeLocal('dm-unit', String(u));
  };

  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${row}"][data-c="${col}"]`);
    el?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const mv = moves[e.key];
    if (!mv) return;
    const input = e.currentTarget;
    if (e.key === 'ArrowLeft' && input.selectionStart !== 0) return;
    if (e.key === 'ArrowRight' && input.selectionEnd !== input.value.length) return;
    e.preventDefault();
    focusCell(row + mv[0], Math.max(0, Math.min(FIELDS.length - 1, col + mv[1])));
  };

  // 엑셀에서 여러 칸 붙여넣기: 현재 칸부터 아래·오른쪽으로 채움
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    setBuf((prev) => {
      const next = { ...prev };
      lines.forEach((line, i) => {
        const it = items[row + i];
        if (!it) return;
        line.split('\t').forEach((cell, j) => {
          const f = FIELDS[col + j];
          if (f) next[key(it.key, f)] = cell.trim();
        });
      });
      return next;
    });
  };

  const isFcst = ym === curYm;
  const refSales = (it: InputItem) => it.sales[ym] ?? 0;
  const l1Total = (m: string) => items.filter((it) => it.sales[m]).length;
  const total = items.reduce(
    (s, it) => ({
      sales: s.sales + refSales(it),
      incentive: s.incentive + (valueOf(it.key, 'incentive') ?? 0),
      general: s.general + (valueOf(it.key, 'general') ?? 0),
      // 변동비 = 매출 × 변동비율
      rate: s.rate + (refSales(it) * (valueOf(it.key, 'rate') ?? 0)) / 100,
    }),
    { sales: 0, incentive: 0, general: 0, rate: 0 },
  );
  const unitLabel = UNITS.find((u) => u.v === unit)?.label;

  return (
    <div className="input-workspace">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div className="flex flex-wrap overflow-hidden rounded-md border border-border" role="group" aria-label="입력 월">
          {months.map(({ ym: m, kind: mk }) => {
            const filled = filledBy.get(m) ?? 0;
            const all = l1Total(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => switchMonth(m)}
                aria-pressed={ym === m}
                title={`${monthLabel(m)} ${mk === 'fcst' ? '진행 중 · 월 예상액' : '실적'} · 입력 ${filled}/${all}개 ${rowName}`}
                className={`border-r border-border px-2.5 py-1.5 leading-tight last:border-r-0 ${
                  ym === m ? 'bg-accent text-white' : 'hover:bg-surface-2'
                }`}
              >
                <span className="block font-semibold">
                  {monthLabel(m)}
                  {mk === 'fcst' && <span className="ml-0.5 text-[10px] font-normal">예상</span>}
                </span>
                <span className={`block text-[10px] ${ym === m ? 'text-white/80' : filled ? 'text-pos' : 'text-muted'}`}>
                  {filled ? `${filled}/${all}` : '미입력'}
                </span>
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">입력 단위</span>
          <select value={unit} onChange={(e) => switchUnit(Number(e.target.value))} className="rounded-md border border-border bg-surface px-2 py-1.5">
            {UNITS.map((u) => (
              <option key={u.v} value={u.v}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">작성자</span>
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              writeLocal('dm-user', e.target.value);
            }}
            placeholder="이름"
            className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
          />
        </label>
        <div className="ml-auto flex items-center gap-3">
          {msg && <span className={msg.ok ? 'text-pos' : 'text-neg'}>{msg.text}</span>}
          {invalid > 0 && <span className="text-neg">숫자가 아닌 칸 {invalid}개</span>}
          <button
            type="button"
            onClick={save}
            disabled={!dirty.size || invalid > 0 || pending}
            className="rounded-md bg-accent px-4 py-1.5 font-semibold text-white disabled:opacity-40"
          >
            {pending ? '저장 중…' : `저장 (${dirty.size}개) · Ctrl+S`}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        <b className="text-text">{monthLabel(ym)}</b>{' '}
        {isFcst
          ? '진행 중인 달은 월 전체 예상 금액을 입력합니다. 누계 손익에는 진행률만큼 반영됩니다.'
          : '마감된 달은 확정된 실적 금액을 입력합니다.'}{' '}
        장려금·일반비 고정비(금액)는 그 달 그 고객그룹3의 제품별 총매출 비중으로 배부되고, 일반비 변동비율(%)은 각 제품의 총매출 × 비율로 자동 계산됩니다{isFcst ? ' (예상 손익은 예상 매출 기준, 아래 변동비는 누계 매출 기준 참고값)' : ''}. 세 열은 엑셀에서 복사해 첫 칸에 붙여넣을 수 있습니다.
      </p>

      <div className="card data-scroll">
        <table className="dtable" ref={tableRef}>
          <thead>
            <tr>
              <th className="text-left">{rowName}</th>
              <th className="text-left">코드</th>
              <th className="num">{isFcst ? '누계 매출' : '실적 매출'} (백만원)</th>
              {FIELDS.map((f) => (
                <Fragment key={f}>
                  <th className="num">{FIELD_LABEL[f]} ({isAmount(f) ? unitLabel : '%'})</th>
                  <th className="num">{isAmount(f) ? `${FIELD_LABEL[f]}율` : '변동비 (백만원)'}</th>
                </Fragment>
              ))}
              <th className="text-left">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td colSpan={2}>합계</td>
              <td className="num">{mil(total.sales)}</td>
              {FIELDS.map((f) => (
                <Fragment key={f}>
                  <td className="num">{isAmount(f) ? fmt.format(total[f] / unit) : pct(total.sales ? total.rate / total.sales : null)}</td>
                  <td className="num">{isAmount(f) ? pct(total.sales ? total[f] / total.sales : null) : mil(total.rate)}</td>
                </Fragment>
              ))}
              <td />
            </tr>
            {items.map((it, r) => {
              const saved = base.get(it.key);
              const sales = refSales(it);
              return (
                <tr key={it.key} className={dirty.has(it.key) ? 'bg-[var(--input-bg)]' : ''}>
                  <td className="font-semibold">{it.label}</td>
                  <td className="text-[11px] text-muted">{it.key}</td>
                  <td className="num text-muted">{mil(sales)}</td>
                  {FIELDS.map((f, c) => {
                    const k = key(it.key, f);
                    const v = valueOf(it.key, f);
                    const b = baseValue(it.key, f);
                    const shown = buf[k] ?? (b ? fmt.format(isAmount(f) ? b / unit : b) : '');
                    return (
                      <Fragment key={f}>
                        <td className="p-1">
                          <input
                            data-r={r}
                            data-c={c}
                            inputMode="decimal"
                            aria-label={`${it.label} ${FIELD_LABEL[f]}`}
                            value={shown}
                            onChange={(e) => setBuf((p) => ({ ...p, [k]: e.target.value }))}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => onKeyDown(e, r, c)}
                            onPaste={(e) => onPaste(e, r, c)}
                            className={`num w-full min-w-[120px] rounded border px-2 py-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                              v == null ? 'border-neg bg-red-50' : 'border-border bg-[var(--input-bg)]'
                            }`}
                          />
                        </td>
                        <td className="num text-muted">{isAmount(f) ? pct(sales && v != null ? v / sales : null) : v ? mil((sales * v) / 100) : ''}</td>
                      </Fragment>
                    );
                  })}
                  <td className="whitespace-nowrap text-[11px] text-muted">
                    {saved ? `${saved.updatedAt.slice(5, 16)} ${saved.updatedBy}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
