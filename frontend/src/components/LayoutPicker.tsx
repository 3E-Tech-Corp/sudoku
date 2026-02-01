import { useState, useRef, useEffect } from 'react';

export interface LayoutConfig {
  cardLayout: 'row' | 'grid';
  operatorPosition: 'center' | 'left' | 'right';
}

const LAYOUT_KEY = 'twentyfour_layout';

export function getDefaultLayout(): LayoutConfig {
  return { cardLayout: 'row', operatorPosition: 'center' };
}

export function getSavedLayout(): LayoutConfig {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cardLayout: parsed.cardLayout === 'grid' ? 'grid' : 'row',
        operatorPosition: ['left', 'right', 'center'].includes(parsed.operatorPosition)
          ? parsed.operatorPosition
          : 'center',
      };
    }
  } catch { /* ignore */ }
  return getDefaultLayout();
}

export function saveLayout(layout: LayoutConfig) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

const CARD_OPTIONS: { value: LayoutConfig['cardLayout']; label: string; icon: string; desc: string }[] = [
  { value: 'row', label: '1×4 Row', icon: '▬▬▬▬', desc: 'Cards in a single row' },
  { value: 'grid', label: '2×2 Grid', icon: '▦', desc: 'Cards in a 2×2 grid' },
];

const OP_OPTIONS: { value: LayoutConfig['operatorPosition']; label: string; desc: string }[] = [
  { value: 'center', label: '⬇ Center', desc: 'Below cards' },
  { value: 'left', label: '⬅ Left', desc: 'Left side' },
  { value: 'right', label: '➡ Right', desc: 'Right side' },
];

interface LayoutPickerProps {
  layout: LayoutConfig;
  onChange: (layout: LayoutConfig) => void;
}

export default function LayoutPicker({ layout, onChange }: LayoutPickerProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const update = (patch: Partial<LayoutConfig>) => {
    const next = { ...layout, ...patch };
    onChange(next);
    saveLayout(next);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
        title="Board layout"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Card Layout */}
          <div>
            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Card Layout</h4>
            <div className="grid grid-cols-2 gap-2">
              {CARD_OPTIONS.map((opt) => {
                const active = layout.cardLayout === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => update({ cardLayout: opt.value })}
                    className={`p-3 rounded-lg text-center transition-all ${
                      active
                        ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                        : 'bg-gray-700/40 border border-transparent hover:bg-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-lg mb-1">{opt.icon}</div>
                    <div className={`text-xs font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>{opt.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operator Position */}
          <div>
            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Operators</h4>
            <div className="grid grid-cols-3 gap-2">
              {OP_OPTIONS.map((opt) => {
                const active = layout.operatorPosition === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => update({ operatorPosition: opt.value })}
                    className={`p-2.5 rounded-lg text-center transition-all ${
                      active
                        ? 'bg-purple-600/20 border border-purple-500/50 ring-1 ring-purple-500/30'
                        : 'bg-gray-700/40 border border-transparent hover:bg-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div className={`text-xs font-semibold ${active ? 'text-purple-300' : 'text-white'}`}>{opt.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
