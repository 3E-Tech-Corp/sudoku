import { useState, useRef, useEffect, useCallback } from 'react';
import type { VideoPosition } from './RoomSettings';

// ===== Types =====

export interface SudokuVisuals {
  background: string;
  highlightSameNumber: boolean;
  videoPosition: VideoPosition;
  boardSize: 'compact' | 'normal' | 'large';
  numberPadStyle: 'row' | 'grid';
}

// ===== Presets =====

export const BACKGROUNDS: { id: string; label: string; class: string; preview: string }[] = [
  { id: 'dark',     label: 'Dark',       class: 'bg-gray-900',     preview: '#111827' },
  { id: 'midnight', label: 'Midnight',    class: 'bg-slate-950',    preview: '#020617' },
  { id: 'navy',     label: 'Navy',        class: 'bg-[#0a1628]',    preview: '#0a1628' },
  { id: 'charcoal', label: 'Charcoal',    class: 'bg-neutral-900',  preview: '#171717' },
  { id: 'wine',     label: 'Wine',        class: 'bg-[#1a0a14]',    preview: '#1a0a14' },
  { id: 'black',    label: 'Black',       class: 'bg-black',        preview: '#000000' },
];

// ===== Persistence =====

const STORAGE_KEY = 'sudoku_room_visuals';

export function getDefaultSudokuVisuals(): SudokuVisuals {
  return {
    background: 'dark',
    highlightSameNumber: true,
    videoPosition: 'inline',
    boardSize: 'normal',
    numberPadStyle: 'row',
  };
}

export function getSavedSudokuVisuals(): SudokuVisuals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        background: BACKGROUNDS.some((b) => b.id === p.background) ? p.background : 'dark',
        highlightSameNumber: typeof p.highlightSameNumber === 'boolean' ? p.highlightSameNumber : true,
        videoPosition: ['inline', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(p.videoPosition) ? p.videoPosition : 'inline',
        boardSize: ['compact', 'normal', 'large'].includes(p.boardSize) ? p.boardSize : 'normal',
        numberPadStyle: p.numberPadStyle === 'grid' ? 'grid' : 'row',
      };
    }
  } catch { /* ignore */ }
  return getDefaultSudokuVisuals();
}

export function saveSudokuVisuals(v: SudokuVisuals) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

export function getSudokuBackgroundClass(id: string): string {
  return BACKGROUNDS.find((b) => b.id === id)?.class ?? 'bg-gray-900';
}

// ===== Component =====

interface SudokuSettingsProps {
  visuals: SudokuVisuals;
  onChange: (v: SudokuVisuals) => void;
}

export default function SudokuSettings({ visuals, onChange }: SudokuSettingsProps) {
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

  const update = useCallback((patch: Partial<SudokuVisuals>) => {
    const next = { ...visuals, ...patch };
    onChange(next);
    saveSudokuVisuals(next);
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
        <div className="absolute right-0 top-full mt-2 z-50 w-72 sm:w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Background</h4>
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
              </>
            )}

            {tab === 'layout' && (
              <>
                {/* Quick Presets */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Quick Presets</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      {
                        label: '📱 Mobile',
                        desc: 'Small board',
                        patch: { boardSize: 'compact' as const, numberPadStyle: 'grid' as const, videoPosition: 'bottom-right' as const },
                      },
                      {
                        label: '📱 Tablet',
                        desc: 'Medium board',
                        patch: { boardSize: 'normal' as const, numberPadStyle: 'row' as const, videoPosition: 'top-right' as const },
                      },
                      {
                        label: '🖥️ Desktop',
                        desc: 'Large board',
                        patch: { boardSize: 'large' as const, numberPadStyle: 'row' as const, videoPosition: 'inline' as const },
                      },
                    ]).map((preset) => {
                      const isActive = Object.entries(preset.patch).every(
                        ([k, v]) => visuals[k as keyof SudokuVisuals] === v
                      );
                      return (
                        <button
                          key={preset.label}
                          onClick={() => update(preset.patch)}
                          className={`p-2.5 rounded-lg text-center transition-all ${
                            isActive
                              ? 'bg-emerald-600/20 border border-emerald-500/50 ring-1 ring-emerald-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className={`text-xs font-semibold ${isActive ? 'text-emerald-300' : 'text-white'}`}>{preset.label}</div>
                          <div className="text-[9px] text-gray-400 mt-0.5">{preset.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-gray-700/50 pt-4" />

                {/* Board Size */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Board Size</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'compact' as const, label: 'Compact', icon: '▪️' },
                      { value: 'normal' as const, label: 'Normal', icon: '▫️' },
                      { value: 'large' as const, label: 'Large', icon: '⬜' },
                    ]).map((opt) => {
                      const active = visuals.boardSize === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ boardSize: opt.value })}
                          className={`p-2 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className="text-lg mb-0.5">{opt.icon}</div>
                          <div className={`text-[10px] font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>{opt.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Number Pad Style */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Number Pad</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'row' as const, label: '1-9 Row', desc: 'Single line' },
                      { value: 'grid' as const, label: '3×3 Grid', desc: 'Square pad' },
                    ]).map((opt) => {
                      const active = visuals.numberPadStyle === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ numberPadStyle: opt.value })}
                          className={`p-2.5 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className={`text-xs font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>{opt.label}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Highlight Same Numbers */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Gameplay</h4>
                  <button
                    onClick={() => update({ highlightSameNumber: !visuals.highlightSameNumber })}
                    className={`w-full p-3 rounded-lg text-left transition-all flex items-center justify-between ${
                      visuals.highlightSameNumber
                        ? 'bg-amber-600/20 border border-amber-500/50'
                        : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                    }`}
                  >
                    <div>
                      <div className={`text-xs font-semibold ${visuals.highlightSameNumber ? 'text-amber-300' : 'text-white'}`}>
                        🔦 Highlight Same Numbers
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">Tap a number to highlight all matching cells</div>
                    </div>
                    <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${
                      visuals.highlightSameNumber ? 'bg-amber-500 justify-end' : 'bg-gray-600 justify-start'
                    }`}>
                      <div className="w-4 h-4 bg-white rounded-full shadow" />
                    </div>
                  </button>
                </div>

                {/* Video Window Position */}
                <div>
                  <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">📹 Video Window</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'inline' as const, label: 'Inline', icon: '📌', desc: 'In header' },
                      { value: 'top-left' as const, label: 'Top Left', icon: '◤', desc: 'Float TL' },
                      { value: 'top-right' as const, label: 'Top Right', icon: '◥', desc: 'Float TR' },
                      { value: 'bottom-left' as const, label: 'Btm Left', icon: '◣', desc: 'Float BL' },
                      { value: 'bottom-right' as const, label: 'Btm Right', icon: '◢', desc: 'Float BR' },
                    ]).map((opt) => {
                      const active = visuals.videoPosition === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => update({ videoPosition: opt.value })}
                          className={`p-2.5 rounded-lg text-center transition-all ${
                            active
                              ? 'bg-cyan-600/20 border border-cyan-500/50 ring-1 ring-cyan-500/30'
                              : 'bg-gray-700/40 border border-transparent hover:bg-gray-700'
                          }`}
                        >
                          <div className="text-lg mb-0.5">{opt.icon}</div>
                          <div className={`text-[10px] font-semibold ${active ? 'text-cyan-300' : 'text-white'}`}>{opt.label}</div>
                          <div className="text-[9px] text-gray-400 mt-0.5">{opt.desc}</div>
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
