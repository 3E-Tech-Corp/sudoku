import { useState, useRef, useEffect } from 'react';
import { DECK_THEMES, type DeckTheme } from '../config/deckThemes';

interface DeckPickerProps {
  currentThemeId: string;
  onChange: (themeId: string) => void;
}

export default function DeckPicker({ currentThemeId, onChange }: DeckPickerProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
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

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
        title="Change card deck"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider px-1 mb-1">Card Deck</h4>
          {DECK_THEMES.map((theme: DeckTheme) => {
            const active = theme.id === currentThemeId;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  onChange(theme.id);
                  setOpen(false);
                }}
                className={`
                  w-full flex items-center gap-3 p-2 rounded-lg transition-all
                  ${active
                    ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                    : 'bg-gray-700/40 border border-transparent hover:bg-gray-700 hover:border-gray-600'
                  }
                `}
              >
                {/* Card preview */}
                <div className="w-12 h-[4.5rem] flex-shrink-0 rounded-md overflow-hidden bg-gray-900 border border-gray-600/50">
                  <img
                    src={theme.previewUrl}
                    alt={theme.name}
                    className="w-full h-full object-contain"
                    style={theme.imgFilter ? { filter: theme.imgFilter } : undefined}
                    draggable={false}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>
                      {theme.name}
                    </span>
                    {active && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300">
                        Active
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{theme.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
