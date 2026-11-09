'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePlans } from '@/actions/input-actions';
import { mil } from '@/lib/format';
import { monthLabel } from '@/lib/period';
import type { PlanLv3 } from '@/lib/plan';

/** 입력 대상 LV3 한 줄 (참고값: 최근 마감 3개월 평균 매출·수량) */
export interface PlanItem {
  l1: string;
  l1t: string;
  l2: string;
  l2t: string;
  l3: string;
  l3t: string;
  refSales: number;
  refQty: number;
}

type Field = 'sales' | 'qty';
const FIELD_LABEL: Record<Field, string> = { sales: '매출계획 (백만원)', qty: '수량계획 (EA)' };
const SCALE: Record<Field, number> = { sales: 1e6, qty: 1 };
const fmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const parse = (s: string): number | null => {
  const t = s.replaceAll(',', '').replaceAll(' ', '').trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const k = (l3: string, f: Field) => `${l3}|${f}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 저장소를 못 쓰는 브라우저 — 작성자 이름만 기억 못 한다 */
  }
}

/** 판매계획 입력: 제품계층 LV3 × 월. LV1 › LV2 머리 행 아래 LV3 행마다 매출(백만원)·수량(EA) */
export default function PlanInput({ months, curYm, items, plans }: { months: string[]; curYm: string; items: PlanItem[]; plans: PlanLv3[] }) {
  const router = useRouter();
  const [ym, setYm] = useState(curYm);
  const [buf, setBuf] = useState<Record<string, string>>({});
  const [user, setUser] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');

  // 작성자 이름(브라우저 저장값)은 마운트 후에만 읽을 수 있다 — 서버 렌더와 첫 화면을 맞추려고 effect에서 반영 (input-grid와 같은 방식)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(readLocal('dm-user') ?? '');
  }, []);

  const saved = useMemo(() => {
    const m = new Map<string, { sales: number; qty: number; at: string; by: string }>();
    for (const p of plans) {
      if (p.ym !== ym) continue;
      const v = m.get(p.l3) ?? { sales: 0, qty: 0, at: p.updatedAt, by: p.updatedBy };
      v.sales += p.sales;
      v.qty += p.qty;
      m.set(p.l3, v);
    }
    return m;
  }, [plans, ym]);
  const filledBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plans) if (p.sales || p.qty) m.set(p.ym, (m.get(p.ym) ?? 0) + 1);
    return m;
  }, [plans]);

  const base = (l3: string, f: Field) => saved.get(l3)?.[f] ?? 0;
  const valueOf = (l3: string, f: Field): number | null => {
    const s = buf[k(l3, f)];
    if (s == null) return base(l3, f);
    const n = parse(s);
    return n == null ? null : Math.round(n * SCALE[f]);
  };
  const dirtyKeys = Object.keys(buf).filter((key) => {
    const [l3, f] = key.split('|') as [string, Field];
    return valueOf(l3, f) !== base(l3, f);
  });
  const invalid = Object.keys(buf).filter((key) => {
    const [l3, f] = key.split('|') as [string, Field];
    return valueOf(l3, f) == null;
  }).length;

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((it) => [it.l1t, it.l2t, it.l3t, it.l3].some((v) => v.toLowerCase().includes(q))) : items;
  const total = shown.reduce(
    (t, it) => {
      t.ref += it.refSales;
      t.sales += valueOf(it.l3, 'sales') ?? 0;
      t.qty += valueOf(it.l3, 'qty') ?? 0;
      return t;
    },
    { ref: 0, sales: 0, qty: 0 },
  );

  const switchMonth = (m: string) => {
    if (dirtyKeys.length && !confirm(`${monthLabel(ym)}에 저장하지 않은 변경 ${dirtyKeys.length}칸이 있습니다. 버리고 이동할까요?`)) return;
    setYm(m);
    setBuf({});
    setMsg(null);
  };

  const save = () =>
    start(async () => {
      const l3s = [...new Set(dirtyKeys.map((key) => key.split('|')[0]))];
      const byL3 = new Map(items.map((it) => [it.l3, it]));
      const res = await savePlans({
        ym,
        user,
        entries: l3s.map((l3) => ({ l3, l3t: byL3.get(l3)?.l3t ?? '', sales: valueOf(l3, 'sales') ?? 0, qty: valueOf(l3, 'qty') ?? 0 })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `${monthLabel(ym)} 판매계획 ${l3s.length}개 LV3를 저장했습니다.` });
        setBuf({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  /** 엑셀에서 여러 줄을 붙여 넣으면 이 칸부터 아래로 채운다 (탭이 있으면 매출·수량 두 열) */
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number, f: Field) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    setBuf((p) => {
      const next = { ...p };
      lines.forEach((line, i) => {
        const it = shown[row + i];
        if (!it) return;
        const cells = line.split('\t');
        next[k(it.l3, f)] = cells[0];
        if (f === 'sales' && cells.length > 1) next[k(it.l3, 'qty')] = cells[1];
      });
      return next;
    });
  };

  // LV1·LV2가 바뀌는 행 앞에 머리 행을 넣는다
  const heads = shown.map((it, i) => ({ head1: i === 0 || it.l1 !== shown[i - 1].l1, head2: i === 0 || it.l1 !== shown[i - 1].l1 || it.l2 !== shown[i - 1].l2 }));
  return (
    <div className="input-workspace">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div className="flex flex-wrap overflow-hidden rounded-md border border-border" role="group" aria-label="계획 월">
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
          <span className="text-muted">찾기</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="브랜드·LV2·LV3" className="w-36 rounded-md border border-border bg-surface px-2 py-1.5" />
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
          <button type="button" onClick={save} disabled={!dirtyKeys.length || invalid > 0 || pending} className="rounded-md bg-accent px-4 py-1.5 font-semibold text-white disabled:opacity-40">
            {pending ? '저장 중…' : `저장${dirtyKeys.length ? ` (${dirtyKeys.length}칸)` : ''}`}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        <b className="text-text">{monthLabel(ym)}</b> 판매계획을 제품계층 LV3별로 입력합니다. 매출은 백만원, 수량은 EA. 엑셀에서 한 열(매출) 또는 두 열(매출·수량)을 복사해 첫 칸에 붙여 넣으면 아래로 채워집니다. 참고 매출은 최근 마감 3개월 월평균입니다.
      </p>
      <div className="card data-scroll">
        <table className="dtable plan-input-table">
          <thead>
            <tr>
              <th className="text-left">제품계층 LV3</th>
              <th className="text-left">코드</th>
              <th className="num">참고 매출 (백만원)</th>
              <th className="num">참고 수량 (EA)</th>
              <th className="num">{FIELD_LABEL.sales}</th>
              <th className="num">{FIELD_LABEL.qty}</th>
              <th className="num">계획 판가 (원)</th>
              <th className="text-left">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td colSpan={2}>합계 ({shown.length.toLocaleString()}개 LV3)</td>
              <td className="num">{mil(total.ref)}</td>
              <td />
              <td className="num">{mil(total.sales)}</td>
              <td className="num">{fmt.format(total.qty)}</td>
              <td />
              <td />
            </tr>
            {shown.map((it, r) => {
              const { head1, head2 } = heads[r];
              const s = valueOf(it.l3, 'sales');
              const qv = valueOf(it.l3, 'qty');
              const sv = saved.get(it.l3);
              return (
                <Fragment key={it.l3}>
                  {head1 && (
                    <tr className="subtotal">
                      <td colSpan={8} className="font-semibold">{it.l1t || it.l1 || '(미지정)'}</td>
                    </tr>
                  )}
                  {head2 && (
                    <tr>
                      <td colSpan={8} className="pl-5 text-[12.5px] font-semibold text-muted">{it.l2t || it.l2 || '(미지정)'}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="pl-8">{it.l3t}</td>
                    <td className="text-[11px] text-muted">{it.l3}</td>
                    <td className="num text-muted">{mil(it.refSales)}</td>
                    <td className="num text-muted">{it.refQty ? fmt.format(Math.round(it.refQty)) : ''}</td>
                    {(['sales', 'qty'] as Field[]).map((f) => {
                      const key = k(it.l3, f);
                      const b = base(it.l3, f);
                      const v = valueOf(it.l3, f);
                      return (
                        <td key={f} className="p-1">
                          <input
                            inputMode="decimal"
                            aria-label={`${it.l3t} ${FIELD_LABEL[f]}`}
                            value={buf[key] ?? (b ? fmt.format(b / SCALE[f]) : '')}
                            onChange={(e) => setBuf((p) => ({ ...p, [key]: e.target.value }))}
                            onFocus={(e) => e.currentTarget.select()}
                            onPaste={(e) => onPaste(e, r, f)}
                            className={`num w-full min-w-[110px] rounded border px-2 py-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                              v == null ? 'border-neg bg-red-50' : 'border-border bg-[var(--input-bg)]'
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="num text-muted">{s && qv ? fmt.format(Math.round(s / qv)) : ''}</td>
                    <td className="whitespace-nowrap text-[11px] text-muted">{sv?.at ? `${sv.at.slice(5, 16)} ${sv.by}` : ''}</td>
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
