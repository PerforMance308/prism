import React from 'react';
import ReactDOM from 'react-dom';
import { QUICK_RANGES } from '../constants/time-ranges.js';

export default function TimeRangePicker({ value, onChange, onRefresh }: {
  value: string;
  onChange: (v: string) => void;
  onRefresh: () => void;
}) {
  const browserTimeZone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Browser time',
    [],
  );
  const [open, setOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState('');
  const [customTo, setCustomTo] = React.useState('');
  const [spinning, setSpinning] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) { document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler); }
  }, [open]);

  React.useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [open]);

  React.useEffect(() => {
    if (!value.includes('|')) return;
    const [from, to] = value.split('|');
    const formatForInput = (raw: string | undefined) => {
      if (!raw) return '';
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    setCustomFrom(formatForInput(from));
    setCustomTo(formatForInput(to));
  }, [value]);

  const displayLabel = QUICK_RANGES.find((r) => r.value === value)?.label
    ?? (value.includes('|') ? 'Custom' : value);

  const applyCustom = () => {
    if (customFrom && customTo) {
      const from = new Date(customFrom);
      const to = new Date(customTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return;
      }
      onChange(`${from.toISOString()}|${to.toISOString()}`);
      setOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-surface-high text-on-surface text-xs rounded-lg px-3 py-1.5 hover:bg-surface-bright transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {displayLabel}
        <svg className="w-3 h-3 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && ReactDOM.createPortal(
        <div ref={ref} className="fixed bg-surface-highest rounded-xl shadow-2xl shadow-black/40 min-w-[260px] py-2" style={{ top: pos.top, left: pos.left, zIndex: 9999 }}>
            <p className="px-3 py-1 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Quick ranges</p>
            <div className="grid grid-cols-2 gap-0.5 px-2">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => { onChange(r.value); setOpen(false); }}
                  className={`text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    value === r.value ? 'bg-primary/15 text-primary' : 'text-on-surface hover:bg-surface-bright'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="border-t border-outline-variant/20 mt-2 pt-2 px-3">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Custom range</p>
              <p className="text-[10px] text-on-surface-variant mb-2">Timezone: {browserTimeZone}</p>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-on-surface-variant mb-0.5 block">From</label>
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full bg-surface-high text-on-surface text-xs rounded-lg px-2.5 py-1.5 border-none focus:ring-1 focus:ring-primary"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-on-surface-variant mb-0.5 block">To</label>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full bg-surface-high text-on-surface text-xs rounded-lg px-2.5 py-1.5 border-none focus:ring-1 focus:ring-primary"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo}
                  className="w-full bg-primary text-on-primary-fixed text-xs font-semibold rounded-lg py-1.5 disabled:opacity-40 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>,
        document.body,
      )}

      <button
        type="button"
        onClick={() => {
          setSpinning(true);
          onRefresh();
          setTimeout(() => setSpinning(false), 700);
        }}
        className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
        title="Refresh"
      >
        <svg className={`w-3.5 h-3.5 transition-transform ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m14.836 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.163 13M15 15h5" />
        </svg>
      </button>
    </div>
  );
}
