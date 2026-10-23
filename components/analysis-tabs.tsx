'use client';

import { useId, useState, type ReactNode } from 'react';

export default function AnalysisTabs({ tabs, label }: { tabs: { label: string; content: ReactNode }[]; label: string }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  return (
    <div className="analysis-tabs">
      <div className="analysis-tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === selected}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => {
              let next = i;
              if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = tabs.length - 1;
              else return;
              e.preventDefault();
              setSelected(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >{tab.label}</button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.label} id={`${id}-panel-${i}`} role="tabpanel" aria-labelledby={`${id}-tab-${i}`} hidden={selected !== i} tabIndex={0}>
          {selected === i && tab.content}
        </div>
      ))}
    </div>
  );
}
