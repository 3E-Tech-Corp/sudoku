import { useState, useRef, useEffect, useCallback } from 'react';
import { DECK_THEMES, type DeckTheme } from '../config/deckThemes';

// ===== Types =====

export interface RoomVisuals {
  background: string;
  feltColor: string;
  cardLayout: 'row' | 'grid';
  operatorPosition: 'center' | 'left' | 'right';
  deckThemeId: string;
  clockStyle: 'none' | 'minimal' | 'digital' | 'analog';
}

// ===== Presets =====

export const BACKGROUNDS: { id: string; label: string; class: string; preview: string }[] = [
  { id: 'dark',     label: 'Dark',       class: 'bg-gray-900',                    preview: '#111827' },
  { id: 'midnight', label: 'Midnight',    class: 'bg-slate-950',                   preview: '#020617' },
  { id: 'navy',     label: 'Navy',        class: 'bg-[#0a1628]',                   preview: '#0a1628' },
  { id: 'charcoal', label: 'Charcoal',    class: 'bg-neutral-900',                 preview: '#171717' },
  { id: 'wine',     label: 'Wine',        class: 'bg-[#1a0a14]',                   preview: '#1a0a14' },
  { id: 'black',    label: 'Black',       class: 'bg-black',                       preview: '#000000' },
];

export const FELT_COLORS: { id: string; label: string; gradient: string; preview: string }[] = [
  { id: 'green',    label: 'Classic Green',  gradient: 'radial-gradient(ellipse at center, #2d7a3a 0%, #1e6b2a 40%, #165a22 100%)', preview: '#1e6b2a' },
  { id: 'blue',     label: 'Royal Blue',     gradient: 'radial-gradient(ellipse at center, #1e4a8a 0%, #163d73 40%, #0f2d5c 100%)', preview: '#163d73' },
  { id: 'red',      label: 'Casino Red',     gradient: 'radial-gradient(ellipse at center, #8a1e1e 0%, #731616 40%, #5c0f0f 100%)', preview: '#731616' },
  { id: 'purple',   label: 'Royal Purple',   gradient: 'radial-gradient(ellipse at center, #4a1e8a 0%, #3d1673 40%, #2d0f5c 100%)', preview: '#3d1673' },
  { id: 'teal',     label: 'Ocean Teal',     gradient: 'radial-gradient(ellipse at center, #1e7a7a 0%, #166b6b 40%, #0f5a5a 100%)', preview: '#166b6b' },
  { id: 'burgundy', label: 'Burgundy',       gradient: 'radial-gradient(ellipse at center, #6b1e3a 0%, #5c1630 40%, #4a0f26 100%)', preview: '#5c1630' },
  { id: 'black',    label: 'Blackout',       gradient: 'radial-gradient(ellipse at center, #2a2a2a 0%, #1a1a1a 40%, #111111 100%)', preview: '#1a1a1a' },
];

// ===== Persistence =====

const STORAGE_KEY = 'twentyfour_room_visuals';

export function getDefaultVisuals(): RoomVisuals {
  return {
    background: 'dark',
    feltColor: 'green',
    cardLayout: 'row',
    operatorPosition: 'center',
    deckThemeId: 'classic',
    clockStyle: 'digital',
  };
}

export function getSavedVisuals(): RoomVisuals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        background: BACKGROUNDS.some((b) => b.id === p.background) ? p.background : 'dark',
        feltColor: FELT_COLORS.some((f) => f.id === p.feltColor) ? p.feltColor : 'green',
        cardLayout: p.cardLayout === 'grid' ? 'grid' : 'row',
        operatorPosition: ['left', 'right', 'center'].includes(p.operatorPosition) ? p.operatorPosition : 'center',
        deckThemeId: DECK_THEMES.some((t: DeckTheme) => t.id === p.deckThemeId) ? p.deckThemeId : 'classic',
        clockStyle: ['none', 'minimal', 'digital', 'analog'].includes(p.clockStyle) ? p.clockStyle : 'digital',
      };
    }
  } catch { /* ignore */ }
  return getDefaultVisuals();
}

export function saveVisuals(v: RoomVisuals) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

// ===== Helpers =====

export function getBackgroundClass(id: string): string {
  return BACKGROUNDS.find((b) => b.id === id)?.class ?? 'bg-gray-900';
}

export function getFeltGradient(id: string): string {
  return FELT_COLORS.find((f) => f.id === id)?.gradient ?? FELT_COLORS[0].gradient;
}

// ===== Component =====

interface RoomSettingsProps {
  visuals: RoomVisuals;
  onChange: (v: RoomVisuals) => void;
}

export default function RoomSettings({ visuals, onChange }: RoomSettingsProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'theme' | 'layout'>('theme');
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

  const update = useCallback((patch: Partial<RoomVisuals>) => {
    const next = { ...visuals, ...patch };
    onChange(next);
    saveVisuals(next);
  }, [visuals, onChange]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
        title="Room settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setTab('theme')}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                tab === 'theme' ? 'text-white bg-gray-700/50 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              🎨 Theme
            </button>
            <button
              onClick={() => setTab('layout')}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                tab === 'layout' ? 'text-white bg-gray-700/50 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              📐 Layout
            </button>
          </div>

          <div className="p-4 max-h-[70vh] overflow-y-auto space-y-5">
            {tab === 'theme' && (
              <>
                {/* Room Background */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Room Background</h4>
                  <div className="grid grid-cols-6 gap-2">
                    {BACKGROUNDS.map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => update({ background: bg.id })}
                        title={bg.label}
                        className={`w-full aspect-square rounded-lg border-2 transition-all ${
                          visuals.background === bg.id
                            ? 'border-blue-500 ring-2 ring-blue-500/30 scale-110'
                            : 'border-gray-600 hover:border-gray-400'
                        }`}
                        style={{ backgroundColor: bg.preview }}
                      />
                    ))}
                  </div>
                </div>

                {/* Table Cloth */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Table Cloth</h4>
                  <div className="grid grid-cols-7 gap-2">
                    {FELT_COLORS.map((fc) => (
                      <button
                        key={fc.id}
                        onClick={() => update({ feltColor: fc.id })}
                        title={fc.label}
                        className={`w-full aspect-square rounded-lg border-2 transition-all ${
                          visuals.feltColor === fc.id
                            ? 'border-blue-500 ring-2 ring-blue-500/30 scale-110'
                            : 'border-gray-600 hover:border-gray-400'
                        }`}
                        style={{ backgroundColor: fc.preview }}
                      />
                    ))}
                  </div>
                </div>

                {/* Card Deck */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Card Deck</h4>
                  <div className="space-y-2">
                    {DECK_THEMES.map((theme: DeckTheme) => {
                      const active = theme.id === visuals.deckThemeId;
                      return (
                        <button
                          key={theme.id}
                          onClick={() => update({ deckThemeId: theme.id })}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                            active
                              ? 'bg-blue-600/20 border border-blue-500/50'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className="w-10 h-14 flex-shrink-0 rounded-md overflow-hidden bg-gray-900 border border-gray-600/50">
                            <img
                              src={theme.previewUrl}
                              alt={theme.name}
                              className="w-full h-full object-contain"
                              style={theme.imgFilter ? { filter: theme.imgFilter } : undefined}
                              draggable={false}
                            />
                          </div>
                          <div className="text-left">
                            <div className={`text-sm font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>
                              {theme.name}
                            </div>
                            <div className="text-xs text-gray-400">{theme.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {tab === 'layout' && (
              <>
                {/* Clock Style */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Clock</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {([
                      { value: 'none' as const, label: 'Off', icon: '—' },
                      { value: 'minimal' as const, label: 'Minimal', icon: '0:42' },
                      { value: 'digital' as const, label: 'Digital', icon: '⏱' },
                      { value: 'analog' as const, label: 'Analog', icon: '🕐' },
                    ]).map((opt) => {
                      const active = visuals.clockStyle === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ clockStyle: opt.value })}
                          className={`p-2 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-amber-600/20 border border-amber-500/50 ring-1 ring-amber-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className="text-lg mb-0.5">{opt.icon}</div>
                          <div className={`text-[10px] font-semibold ${active ? 'text-amber-300' : 'text-white'}`}>{opt.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Card Arrangement */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Card Arrangement</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'row' as const, label: '1×4 Row', icon: '━━━━', desc: 'All in a line' },
                      { value: 'grid' as const, label: '2×2 Grid', icon: '▦', desc: 'Square layout' },
                    ].map((opt) => {
                      const active = visuals.cardLayout === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ cardLayout: opt.value })}
                          className={`p-3 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className="text-xl mb-1">{opt.icon}</div>
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
                    {[
                      { value: 'left' as const, label: '⬅ Left', desc: 'Left side' },
                      { value: 'center' as const, label: '⬇ Center', desc: 'Below cards' },
                      { value: 'right' as const, label: '➡ Right', desc: 'Right side' },
                    ].map((opt) => {
                      const active = visuals.operatorPosition === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ operatorPosition: opt.value })}
                          className={`p-2.5 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-purple-600/20 border border-purple-500/50 ring-1 ring-purple-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className={`text-xs font-semibold ${active ? 'text-purple-300' : 'text-white'}`}>{opt.label}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
