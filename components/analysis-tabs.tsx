'use client';

import { Activity, useId, useState, type ReactNode } from 'react';

export default function AnalysisTabs({
  tabs, label, defaultIndex = 0, selectedIndex, onSelect, preserve = false,
}: {
  tabs: { label: string; content: ReactNode }[];
  label: string;
  defaultIndex?: number;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  preserve?: boolean;
}) {
  const [internal, setInternal] = useState(defaultIndex);
  const [visited, setVisited] = useState([defaultIndex]);
  const id = useId();
  const selected = selectedIndex ?? internal;
  const select = (index: number) => {
    if (preserve && !visited.includes(index)) setVisited([...visited, index]);
    if (selectedIndex === undefined) setInternal(index);
    onSelect?.(index);
  };

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
            onClick={() => select(i)}
            onKeyDown={(e) => {
              let next = i;
              if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = tabs.length - 1;
              else return;
              e.preventDefault();
              select(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >{tab.label}</button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <Activity key={tab.label} mode={selected === i ? 'visible' : 'hidden'}>
          <div className="analysis-panel" id={`${id}-panel-${i}`} role="tabpanel" aria-labelledby={`${id}-tab-${i}`} hidden={selected !== i} tabIndex={0}>
            {(selected === i || (preserve && visited.includes(i))) && tab.content}
          </div>
        </Activity>
      ))}
    </div>
  );
}
