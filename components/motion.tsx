'use client';

// 관리자 분석 화면(손익 인사이트·실적 손익계산서) 공용 모션·UI 조각
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 화면에 처음 들어온 뒤로 true (등장 애니메이션은 한 번만) */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

/** SVG를 실제 폭으로 그려 글씨가 늘어나지 않게 한다 */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** active가 된 다음 프레임에 true — CSS 전환이 시작 상태에서 출발하도록 */
export function useArmed(active: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, [active]);
  return on;
}

/** 숫자 카운트업: 처음엔 0부터 1초, 값이 바뀌면 이전 값에서 0.4초 */
export function CountUp({ value, format, active }: { value: number; format: (v: number) => string; active: boolean }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (!active) return;
    const start = from.current;
    const ms = reducedMotion() ? 0 : first.current ? 1000 : 400;
    first.current = false;
    const t0 = performance.now();
    let raf = 0;
    const f = (t: number) => {
      const p = ms ? Math.min((t - t0) / ms, 1) : 1;
      const v = start + (value - start) * easeOut(p);
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value, active]);
  return <>{format(shown)}</>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, desc, tools, children, className = '' }: { title: string; desc: ReactNode; tools?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card il-panel ${className}`}>
      <div className="panel-heading il-heading">
        <div>
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>
        {tools}
      </div>
      {children}
    </section>
  );
}
