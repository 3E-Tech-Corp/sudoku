import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import { sounds } from '../services/sounds';
import VideoChat from '../components/VideoChat';
import GameTimer from '../components/GameTimer';
import RoomSettings, { getSavedVisuals, saveVisuals, getBackgroundClass, getFeltGradient, type RoomVisuals } from '../components/RoomSettings';
import { getThemeById } from '../config/deckThemes';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import confetti from 'canvas-confetti';
import type { HubConnection } from '@microsoft/signalr';

// ===== Types =====

interface TwentyFourCard {
  number: number;
  suit: string;
}

interface TwentyFourStep {
  card1: number;
  operation: string;
  card2: number;
  result: number;
}

interface TwentyFourGameState {
  id: number;
  roomId: number;
  cardsJson: string;
  deckJson: string;
  handNumber: number;
  status: string;
  winnerName: string | null;
  winningStepsJson: string | null;
  scoresJson: string;
}

interface Member {
  displayName: string;
  color: string;
  joinedAt: string;
}

interface RoomData {
  code: string;
  status: string;
  hostName: string;
  mode: string;
  gameType: string;
  timeLimitSeconds: number | null;
  startedAt: string | null;
  members: Member[];
  playerColors: Record<string, string>;
  twentyFourState: TwentyFourGameState | null;
}

interface JoinResponse {
  displayName: string;
  color: string;
  room: RoomData;
}

// ===== Row state =====

interface RowState {
  card1: number | null;
  operator: string | null;
  card2: number | null;
  result: number | null;
  locked: boolean;
}

function emptyRow(): RowState {
  return { card1: null, operator: null, card2: null, result: null, locked: false };
}

// ===== Card Visual Component (uses real SVG card images) =====

function PlayingCard({
  card,
  selected,
  used,
  isResult,
  onClick,
  animDelay,
  faceDown,
  themeId,
  dealt,
}: {
  card: TwentyFourCard | { number: number; suit: string };
  selected?: boolean;
  used?: boolean;
  isResult?: boolean;
  onClick?: () => void;
  animDelay?: number;
  faceDown?: boolean;
  themeId?: string;
  dealt?: boolean;  // false = card hasn't been dealt yet (hidden), true = on table
}) {
  const theme = getThemeById(themeId || 'classic');
  const isRealCard = card.suit === 'Hearts' || card.suit === 'Diamonds' || card.suit === 'Clubs' || card.suit === 'Spades';

  // If dealt is explicitly false, card is not on the table yet
  if (dealt === false) {
    return (
      <div className="w-[64px] h-[90px] sm:w-[88px] sm:h-[124px]" />
    );
  }

  const cardFace = isRealCard ? (
    <>
      <img
        src={theme.cardUrl(card.number, card.suit)}
        alt={`${card.number} of ${card.suit}`}
        className="w-full h-full object-contain rounded-lg"
        style={theme.imgFilter ? { filter: theme.imgFilter } : undefined}
        draggable={false}
      />
      {isResult && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow z-10">
          <span className="text-[9px] text-white font-bold">R</span>
        </div>
      )}
    </>
  ) : (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-amber-100 rounded-lg">
      <div className="text-2xl sm:text-3xl font-bold text-gray-800">{card.number}</div>
      <div className="text-xs text-amber-600 font-medium mt-1">Result</div>
      {isResult && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow z-10">
          <span className="text-[9px] text-white font-bold">R</span>
        </div>
      )}
    </div>
  );

  return (
    <button
      onClick={onClick}
      disabled={used || faceDown}
      className="w-[64px] h-[90px] sm:w-[88px] sm:h-[124px] [perspective:600px] cursor-pointer"
      style={{ animationDelay: animDelay ? `${animDelay}ms` : undefined }}
    >
      <div
        className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: faceDown ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* Front face (card face) */}
        <div
          className={`absolute inset-0 [backface-visibility:hidden] rounded-lg sm:rounded-xl border-2 flex items-center justify-center overflow-hidden
            ${selected
              ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)] scale-105 bg-white'
              : used
              ? 'border-gray-600 opacity-40 bg-gray-700'
              : isResult
              ? 'border-amber-400 hover:border-amber-300 hover:shadow-lg bg-gradient-to-b from-amber-50 to-amber-100'
              : 'border-gray-300 hover:border-blue-400 hover:shadow-lg active:scale-95 bg-white'
            }
          `}
        >
          {cardFace}
        </div>

        {/* Back face (card back) */}
        <div
          className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-lg sm:rounded-xl border-2 border-blue-700 shadow-md overflow-hidden"
        >
          <img
            src={theme.backUrl}
            alt="Card back"
            className="w-full h-full object-fill rounded-lg"
            draggable={false}
          />
        </div>
      </div>
    </button>
  );
}

/** Shuffle deck animation — shows a deck riffling */
function ShuffleDeck({ themeId, active }: { themeId?: string; active: boolean }) {
  const theme = getThemeById(themeId || 'classic');
  if (!active) return null;

  return (
    <div className="flex justify-center items-center py-4">
      <div className="relative w-[88px] h-[124px]">
        {/* Deck stack */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="absolute inset-0 rounded-xl border-2 border-blue-700 shadow-md overflow-hidden"
            style={{
              transform: `translateX(${i * 2}px) translateY(${-i * 1}px)`,
              animation: active ? `shuffle-riffle 1.2s ease-in-out ${i * 0.05}s` : undefined,
              zIndex: 5 - i,
            }}
          >
            <img src={theme.backUrl} alt="" className="w-full h-full object-fill rounded-lg" draggable={false} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes shuffle-riffle {
          0% { transform: translateX(0px) translateY(0px); }
          15% { transform: translateX(-20px) translateY(-8px) rotate(-5deg); }
          30% { transform: translateX(-15px) translateY(-3px) rotate(-2deg); }
          50% { transform: translateX(20px) translateY(-8px) rotate(5deg); }
          65% { transform: translateX(15px) translateY(-3px) rotate(2deg); }
          80% { transform: translateX(-5px) translateY(-2px) rotate(-1deg); }
          100% { transform: translateX(0px) translateY(0px) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}

// ===== Operator Button (large, touch-friendly, min 48×48) =====

function OperatorButton({
  op,
  selected,
  onClick,
}: {
  op: string;
  selected?: boolean;
  onClick: () => void;
}) {
  const display = op === '*' ? '×' : op === '/' ? '÷' : op;
  return (
    <button
      onClick={onClick}
      className={`
        min-w-[44px] min-h-[44px] w-11 h-11 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl sm:rounded-2xl text-xl sm:text-2xl md:text-3xl font-bold transition-all
        ${selected
          ? 'bg-purple-600 text-white border-2 border-purple-400 shadow-[0_0_12px_rgba(147,51,234,0.5)] scale-105'
          : 'bg-gray-700 text-gray-200 border-2 border-gray-600 hover:bg-purple-900/50 hover:border-purple-500 active:scale-95'
        }
      `}
    >
      {display}
    </button>
  );
}

// ===== Equation Row (operator slot is display-only) =====

function EquationRow({
  row,
  rowIndex,
  isActive,
  onSlotClick,
}: {
  row: RowState;
  rowIndex: number;
  isActive: boolean;
  onSlotClick: (slot: 'card1' | 'card2') => void;
}) {
  const opDisplay = row.operator === '*' ? '×' : row.operator === '/' ? '÷' : row.operator;
  const isFinal = rowIndex === 2;

  return (
    <div className={`
      flex items-center gap-1.5 sm:gap-3 p-2 sm:p-4 rounded-lg sm:rounded-xl transition-all
      ${row.locked
        ? 'bg-green-900/20 border border-green-700/30'
        : isActive
        ? 'bg-gray-700/50 border border-blue-500/30'
        : 'bg-gray-800/50 border border-gray-700/30 opacity-50'
      }
    `}>
      <span className="text-gray-500 text-[10px] sm:text-xs w-3 sm:w-4 flex-shrink-0">R{rowIndex + 1}</span>

      {/* Card 1 slot */}
      <button
        onClick={() => !row.locked && isActive && onSlotClick('card1')}
        disabled={row.locked || !isActive}
        className={`
          w-10 h-10 sm:w-14 sm:h-14 rounded-md sm:rounded-lg flex items-center justify-center text-base sm:text-lg font-bold transition-all
          ${row.card1 !== null
            ? 'bg-white text-gray-800 border-2 border-blue-400'
            : isActive
            ? 'bg-gray-600 border-2 border-dashed border-gray-500 text-gray-400 hover:border-blue-400'
            : 'bg-gray-700 border-2 border-dashed border-gray-600 text-gray-500'
          }
        `}
      >
        {row.card1 !== null ? row.card1 : '?'}
      </button>

      {/* Operator slot — display only */}
      <div
        className={`
          w-8 h-8 sm:w-12 sm:h-12 rounded-md sm:rounded-lg flex items-center justify-center text-base sm:text-xl font-bold
          ${row.operator
            ? 'bg-purple-600 text-white border-2 border-purple-400'
            : isActive
            ? 'bg-gray-600 border-2 border-dashed border-gray-500 text-gray-400'
            : 'bg-gray-700 border-2 border-dashed border-gray-600 text-gray-500'
          }
        `}
      >
        {opDisplay || '⊕'}
      </div>

      {/* Card 2 slot */}
      <button
        onClick={() => !row.locked && isActive && onSlotClick('card2')}
        disabled={row.locked || !isActive}
        className={`
          w-10 h-10 sm:w-14 sm:h-14 rounded-md sm:rounded-lg flex items-center justify-center text-base sm:text-lg font-bold transition-all
          ${row.card2 !== null
            ? 'bg-white text-gray-800 border-2 border-blue-400'
            : isActive
            ? 'bg-gray-600 border-2 border-dashed border-gray-500 text-gray-400 hover:border-blue-400'
            : 'bg-gray-700 border-2 border-dashed border-gray-600 text-gray-500'
          }
        `}
      >
        {row.card2 !== null ? row.card2 : '?'}
      </button>

      {/* = sign */}
      <span className="text-gray-400 text-lg sm:text-xl font-bold">=</span>

      {/* Result */}
      <div className={`
        w-10 h-10 sm:w-14 sm:h-14 rounded-md sm:rounded-lg flex items-center justify-center text-base sm:text-lg font-bold
        ${row.result !== null
          ? row.result === 24 && isFinal
            ? 'bg-green-600 text-white border-2 border-green-400 animate-pulse'
            : 'bg-amber-100 text-gray-800 border-2 border-amber-400'
          : 'bg-gray-700 border-2 border-gray-600 text-gray-500'
        }
      `}>
        {row.result !== null ? row.result : '—'}
      </div>
    </div>
  );
}

// ===== Encouraging phrases =====

const WIN_PHRASES_SELF: { text: string; audio: string }[] = [
  { text: '🔥 Nicely done!', audio: '/audio/win_nicely_done.mp3' },
  { text: '⚡ Excellent!', audio: '/audio/win_excellent.mp3' },
  { text: '🧠 Brilliant mind!', audio: '/audio/win_brilliant.mp3' },
  { text: '💪 You crushed it!', audio: '/audio/win_crushed.mp3' },
  { text: '🎯 Sharp as a tack!', audio: '/audio/win_sharp.mp3' },
  { text: '👏 Masterful!', audio: '/audio/win_masterful.mp3' },
  { text: '✨ Pure genius!', audio: '/audio/win_genius.mp3' },
  { text: '🏅 Math wizard!', audio: '/audio/win_wizard.mp3' },
  { text: '💎 Flawless!', audio: '/audio/win_flawless.mp3' },
  { text: '🚀 Unstoppable!', audio: '/audio/win_unstoppable.mp3' },
  { text: '🎉 Nailed it!', audio: '/audio/win_nailed.mp3' },
  { text: '😎 Too easy for you!', audio: '/audio/win_too_easy.mp3' },
  { text: '🌟 Spectacular!', audio: '/audio/win_spectacular.mp3' },
  { text: '🧮 Calculator who?', audio: '/audio/win_calculator.mp3' },
  { text: '👑 Crown yourself!', audio: '/audio/win_crown.mp3' },
];

const WIN_PHRASES_OTHER = [
  '🔥 Nicely done, {name}!',
  '⚡ {name} is on fire!',
  '🧠 Big brain move by {name}!',
  '💪 {name} crushed it!',
  '🎯 {name} strikes again!',
  '👏 Well played, {name}!',
  '✨ {name} makes it look easy!',
  '🏅 {name} the math wizard!',
  '💎 Flawless by {name}!',
  '🚀 {name} is unstoppable!',
  '🎉 {name} nailed it!',
  '🌟 Spectacular, {name}!',
  '👑 {name} takes the crown!',
];

function playWinAudio(audioUrl: string) {
  try {
    const audio = new Audio(audioUrl);
    audio.volume = 0.8;
    audio.play().catch(() => {}); // silently fail if autoplay blocked
  } catch {
    // Audio not available
  }
}

function getWinPhrase(winnerName: string, isMe: boolean): { text: string; audio: string | null } {
  if (isMe) {
    const phrase = WIN_PHRASES_SELF[Math.floor(Math.random() * WIN_PHRASES_SELF.length)];
    return { text: phrase.text, audio: phrase.audio };
  }
  const template = WIN_PHRASES_OTHER[Math.floor(Math.random() * WIN_PHRASES_OTHER.length)];
  return { text: template.replace(/{name}/g, winnerName), audio: null };
}

// ===== Hand Stopwatch Component =====

function AnalogClock({ seconds }: { seconds: number }) {
  const totalSec = seconds % 3600;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const minuteAngle = (m / 60) * 360 - 90;
  const secondAngle = (s / 60) * 360 - 90;
  const r = 20;
  const cx = 24;
  const cy = 24;

  const polarToCart = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos((angle * Math.PI) / 180),
    y: cy + radius * Math.sin((angle * Math.PI) / 180),
  });

  const mEnd = polarToCart(minuteAngle, r * 0.6);
  const sEnd = polarToCart(secondAngle, r * 0.85);

  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#4B5563" strokeWidth="2" />
      {/* Tick marks */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * 360 - 90;
        const inner = polarToCart(angle, r - 3);
        const outer = polarToCart(angle, r - 1);
        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#6B7280" strokeWidth={i % 3 === 0 ? 2 : 1} />;
      })}
      {/* Minute hand */}
      <line x1={cx} y1={cy} x2={mEnd.x} y2={mEnd.y} stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" />
      {/* Second hand */}
      <line x1={cx} y1={cy} x2={sEnd.x} y2={sEnd.y} stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="2" fill="#F59E0B" />
    </svg>
  );
}

function HandStopwatch({ running, resetKey, style }: { running: boolean; resetKey: number; style: string }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());
  const frameRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
  }, [resetKey]);

  useEffect(() => {
    if (running) {
      const tick = () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      frameRef.current = setInterval(tick, 1000);
      return () => { if (frameRef.current) clearInterval(frameRef.current); };
    } else {
      if (frameRef.current) clearInterval(frameRef.current);
    }
  }, [running, resetKey]);

  if (style === 'none') return null;

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const timeStr = `${m}:${s.toString().padStart(2, '0')}`;

  if (style === 'analog') {
    return (
      <div className="flex items-center gap-2">
        <AnalogClock seconds={elapsed} />
        <span className="font-mono text-sm text-gray-400 tabular-nums">{timeStr}</span>
      </div>
    );
  }

  if (style === 'minimal') {
    return (
      <span className="font-mono text-lg text-gray-400 tabular-nums">{timeStr}</span>
    );
  }

  // digital (default)
  return (
    <div className="flex items-center gap-2 text-gray-300">
      <span className="text-lg">⏱</span>
      <span className="font-mono text-xl sm:text-2xl font-bold tabular-nums">
        {timeStr}
      </span>
    </div>
  );
}

// ===== Main Component =====

export default function TwentyFourRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [myName, setMyName] = useState('');
  const [myColor, setMyColor] = useState('#3B82F6');
  const [loading, setLoading] = useState(true);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState('');
  const connRef = useRef<HubConnection | null>(null);

  // Unified room visuals (background, felt, layout, deck — persisted in localStorage)
  const [visuals, setVisuals] = useState<RoomVisuals>(getSavedVisuals);
  const handleVisualsChange = useCallback((v: RoomVisuals) => {
    setVisuals(v);
    saveVisuals(v);
  }, []);

  // Derived values for convenience
  const themeId = visuals.deckThemeId;
  const layout = visuals;

  // Game state
  const [cards, setCards] = useState<TwentyFourCard[]>([]);
  const [rows, setRows] = useState<RowState[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [activeRow, setActiveRow] = useState(0);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [resultCards, setResultCards] = useState<Map<number, number>>(new Map());
  const [handNumber, setHandNumber] = useState(1);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [showWin, setShowWin] = useState<string | null>(null);
  const [winPhrase, setWinPhrase] = useState('');
  const [shuffling, setShuffling] = useState(false);
  const [dealtCount, setDealtCount] = useState(4); // how many cards have been dealt (0-4)
  const [faceDown, setFaceDown] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [timerExpired, setTimerExpired] = useState(false);
  const [handClockRunning, setHandClockRunning] = useState(false);
  const [handClockKey, setHandClockKey] = useState(0);

  // Reset game state for new hand — full sequence: shuffle → deal face-down → flip
  const resetForNewHand = useCallback((newCards: TwentyFourCard[]) => {
    setCards(newCards);
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setActiveRow(0);
    setPlacements({});
    setResultCards(new Map());
    setErrorMsg('');
    setShowWin(null);
    setFaceDown(true);
    setDealtCount(0);
    setHandClockRunning(false);

    // Phase 1: Shuffle animation + sound (0 – 1200ms)
    setShuffling(true);
    sounds.shuffle();

    // Phase 2: Deal cards face-down one by one (1200 – 2000ms)
    setTimeout(() => {
      setShuffling(false);
      // Deal each card with stagger
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          setDealtCount((c) => c + 1);
          sounds.deal();
        }, i * 180);
      }
    }, 1200);

    // Phase 3: Flip all 4 simultaneously (2200ms)
    setTimeout(() => {
      setFaceDown(false);
      sounds.flip();
      setHandClockKey((k) => k + 1);
      setHandClockRunning(true);
    }, 2200);
  }, []);

  const joinAndLoad = useCallback(
    async (displayName: string) => {
      if (!code) return;
      try {
        const resp = await api.post<JoinResponse>(`/rooms/${code}/join`, { displayName });
        setMyName(resp.displayName);
        setMyColor(resp.color);
        setRoom(resp.room);
        localStorage.setItem('sudoku_name', displayName);

        if (resp.room.twentyFourState) {
          const gs = resp.room.twentyFourState;
          const parsedCards: TwentyFourCard[] = JSON.parse(gs.cardsJson);
          const parsedScores: Record<string, number> = JSON.parse(gs.scoresJson);
          setHandNumber(gs.handNumber);
          setScores(parsedScores);
          // Play the full deal animation on join
          resetForNewHand(parsedCards);
        }

        const conn = await startGameConnection();
        connRef.current = conn;
        await conn.invoke('JoinRoom', code, displayName);

        conn.on('PlayerJoined', (_playerName: string) => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members, playerColors: r.playerColors } : prev);
          });
        });

        conn.on('PlayerLeft', (_playerName: string) => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members } : prev);
          });
        });

        conn.on('24GameWon', (winnerName: string, _stepsJson: string, scoresJson: string) => {
          const savedName = localStorage.getItem('sudoku_name') || '';
          const phrase = getWinPhrase(winnerName, winnerName === savedName);
          setShowWin(winnerName);
          setWinPhrase(phrase.text);
          if (phrase.audio) {
            // Small delay so win sound plays first, then the voice
            setTimeout(() => playWinAudio(phrase.audio!), 600);
          }
          setHandClockRunning(false);
          const newScores = JSON.parse(scoresJson);
          setScores(newScores);
          sounds.win();
          confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'] });
          setTimeout(() => {
            confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 } });
            confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } });
          }, 300);
        });

        conn.on('24NewHand', (cardsJson: string, handNum: number, scoresJson: string) => {
          const newCards: TwentyFourCard[] = JSON.parse(cardsJson);
          const newScores = JSON.parse(scoresJson);
          setHandNumber(handNum);
          setScores(newScores);
          // Wait for win banner, then play full shuffle → deal → flip sequence
          setTimeout(() => { setShowWin(null); resetForNewHand(newCards); }, 2000);
        });

        conn.on('24HandSkipped', (_player: string) => {});

        conn.on('24RowCompleted', (_player: string, row: number, card1: number, op: string, card2: number, result: number) => {
          setRows((prev) => { const n = [...prev]; n[row] = { card1, operator: op, card2, result, locked: true }; return n; });
          setResultCards((prev) => new Map(prev).set(row, result));
          // Advance activeRow past any locked rows
          setActiveRow((prev) => {
            let next = prev;
            while (next < 3) {
              // We need to check the updated rows — but we only know this row was just locked
              if (next === row) { next++; continue; }
              break;
            }
            return Math.max(prev, row + 1);
          });
        });

        // Granular co-op: partner placed a card into a slot
        conn.on('24CardPlaced', (_player: string, row: number, slot: number, cardValue: number, sourceKey: string) => {
          setRows((prev) => {
            const n = [...prev];
            const r = { ...n[row] };
            if (slot === 0) r.card1 = cardValue;
            else r.card2 = cardValue;
            n[row] = r;
            return n;
          });
          const slotName = slot === 0 ? 'card1' : 'card2';
          setPlacements((prev) => ({ ...prev, [`${row}-${slotName}`]: sourceKey }));
        });

        // Granular co-op: partner placed an operator
        conn.on('24OperatorPlaced', (_player: string, row: number, op: string) => {
          setRows((prev) => {
            const n = [...prev];
            n[row] = { ...n[row], operator: op };
            return n;
          });
        });

        // Granular co-op: partner cleared a full row
        conn.on('24Undo', (_player: string, row: number) => {
          setRows((prev) => {
            const n = [...prev];
            n[row] = emptyRow();
            return n;
          });
          setPlacements((prev) => {
            const p = { ...prev };
            delete p[`${row}-card1`];
            delete p[`${row}-card2`];
            return p;
          });
          setActiveRow(row);
        });

        // Granular co-op: partner cleared a single slot
        conn.on('24SlotCleared', (_player: string, row: number, slot: string, _sourceKey: string) => {
          setRows((prev) => {
            const n = [...prev];
            const r = { ...n[row] };
            if (slot === 'card1') r.card1 = null;
            else r.card2 = null;
            r.result = null;
            n[row] = r;
            return n;
          });
          setPlacements((prev) => { const p = { ...prev }; delete p[`${row}-${slot}`]; return p; });
        });

        conn.on('24ProgressUpdated', (_player: string, _completedRows: number) => {});

        conn.on('24Error', (msg: string) => { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 3000); });

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to join room');
        setLoading(false);
      }
    },
    [code, resetForNewHand]
  );

  useEffect(() => {
    if (!code) { navigate('/'); return; }
    const savedName = localStorage.getItem('sudoku_name');
    if (savedName) { joinAndLoad(savedName); } else { setLoading(false); setNeedsName(true); }
    return () => {
      if (connRef.current) connRef.current.invoke('LeaveRoom', code, myName).catch(() => {});
      stopGameConnection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setNeedsName(false);
    setLoading(true);
    joinAndLoad(nameInput.trim());
  };

  // Place a number into the next empty card slot of the current row (tap-to-place)
  const placeNumber = useCallback((value: number, sourceKey: string) => {
    if (faceDown) return;
    const row = rows[activeRow];
    if (row.locked) return;

    // Find the next empty card slot: card1 first, then card2
    let targetSlot: 'card1' | 'card2' | null = null;
    if (row.card1 === null) targetSlot = 'card1';
    else if (row.card2 === null) targetSlot = 'card2';
    if (!targetSlot) return; // both slots filled

    const newRows = [...rows];
    const newRow = { ...row };
    newRow[targetSlot] = value;

    const slotKey = `${activeRow}-${targetSlot}`;
    const slotIndex = targetSlot === 'card1' ? 0 : 1;
    setPlacements((prev) => ({ ...prev, [slotKey]: sourceKey }));

    // Broadcast card placement in cooperative mode
    if (connRef.current && code && room?.mode === 'Cooperative') {
      connRef.current.invoke('Place24Card', code, myName, activeRow, slotIndex, value, sourceKey).catch(() => {});
    }

    // Auto-calculate and auto-lock when all 3 slots filled
    if (newRow.card1 !== null && newRow.card2 !== null && newRow.operator !== null) {
      const result = calculateResult(newRow.card1, newRow.operator, newRow.card2);
      if (result !== null && result >= 0 && Number.isInteger(result)) {
        newRow.result = result;
        newRow.locked = true;
        newRows[activeRow] = newRow;
        setRows(newRows);
        sounds.cardPlace();

        // Add result as available card
        setResultCards((prev) => new Map(prev).set(activeRow, result));

        // Check win on row 3
        if (activeRow === 2 && result === 24) {
          const steps: TwentyFourStep[] = newRows.map((r) => ({
            card1: r.card1!, operation: r.operator!, card2: r.card2!, result: r.result!,
          }));
          if (connRef.current && code) connRef.current.invoke('Win24Game', code, myName, JSON.stringify(steps));
          return;
        }
        if (activeRow === 2 && result !== 24) {
          setErrorMsg('Final result must equal 24! Row unlocked — try again.');
          sounds.error();
          newRow.locked = false;
          newRow.result = null;
          newRows[activeRow] = newRow;
          setRows(newRows);
          setResultCards((prev) => { const m = new Map(prev); m.delete(activeRow); return m; });
          setTimeout(() => setErrorMsg(''), 3000);
          return;
        }

        // Advance to next row
        sounds.rowComplete();
        setActiveRow((prev) => prev + 1);

        if (connRef.current && code && room?.mode === 'Cooperative') {
          connRef.current.invoke('Complete24Row', code, myName, activeRow, newRow.card1, newRow.operator, newRow.card2, result);
        }
        return;
      } else {
        newRow.result = null;
        setErrorMsg('Result must be a non-negative whole number. Try different numbers or operator.');
        sounds.error();
        setTimeout(() => setErrorMsg(''), 3000);
      }
    }

    newRows[activeRow] = newRow;
    setRows(newRows);
    sounds.cardPlace();
  }, [faceDown, rows, activeRow, code, myName, room?.mode]);

  // Place an operator into the active row (tap-to-place)
  const placeOperator = useCallback((op: string) => {
    if (faceDown) return;
    const row = rows[activeRow];
    if (row.locked) return;

    const newRows = [...rows];
    const newRow = { ...row, operator: op };

    // Broadcast operator placement in cooperative mode
    if (connRef.current && code && room?.mode === 'Cooperative') {
      connRef.current.invoke('Place24Operator', code, myName, activeRow, op).catch(() => {});
    }

    // Auto-calculate and auto-lock when all 3 slots filled
    if (newRow.card1 !== null && newRow.card2 !== null) {
      const result = calculateResult(newRow.card1, op, newRow.card2);
      if (result !== null && result >= 0 && Number.isInteger(result)) {
        newRow.result = result;
        newRow.locked = true;
        newRows[activeRow] = newRow;
        setRows(newRows);
        sounds.operatorSelect();

        // Add result as available card
        setResultCards((prev) => new Map(prev).set(activeRow, result));

        // Check win on row 3
        if (activeRow === 2 && result === 24) {
          const steps: TwentyFourStep[] = newRows.map((r) => ({
            card1: r.card1!, operation: r.operator!, card2: r.card2!, result: r.result!,
          }));
          if (connRef.current && code) connRef.current.invoke('Win24Game', code, myName, JSON.stringify(steps));
          return;
        }
        if (activeRow === 2 && result !== 24) {
          setErrorMsg('Final result must equal 24! Row unlocked — try again.');
          sounds.error();
          newRow.locked = false;
          newRow.result = null;
          newRows[activeRow] = newRow;
          setRows(newRows);
          setResultCards((prev) => { const m = new Map(prev); m.delete(activeRow); return m; });
          setTimeout(() => setErrorMsg(''), 3000);
          return;
        }

        // Advance to next row
        sounds.rowComplete();
        setActiveRow((prev) => prev + 1);

        if (connRef.current && code && room?.mode === 'Cooperative') {
          connRef.current.invoke('Complete24Row', code, myName, activeRow, newRow.card1, newRow.operator, newRow.card2, result);
        }
        return;
      } else {
        newRow.result = null;
        setErrorMsg('Result must be a non-negative whole number. Try a different operator.');
        sounds.error();
        setTimeout(() => setErrorMsg(''), 3000);
      }
    }

    newRows[activeRow] = newRow;
    setRows(newRows);
    sounds.operatorSelect();
  }, [faceDown, rows, activeRow, code, myName, room?.mode]);

  // Undo current row (clear all placements)
  const undoCurrentRow = useCallback(() => {
    const row = rows[activeRow];
    if (row.locked) return;
    const newRows = [...rows];
    newRows[activeRow] = emptyRow();
    setRows(newRows);
    setPlacements((prev) => {
      const newP = { ...prev };
      delete newP[`${activeRow}-card1`];
      delete newP[`${activeRow}-card2`];
      return newP;
    });
    setErrorMsg('');
    sounds.undo();

    // Broadcast undo in cooperative mode
    if (connRef.current && code && room?.mode === 'Cooperative') {
      connRef.current.invoke('Undo24', code, myName, activeRow).catch(() => {});
    }
  }, [rows, activeRow, code, myName, room?.mode]);

  // Skip hand
  const skipHand = useCallback(() => {
    if (connRef.current && code) connRef.current.invoke('Skip24Hand', code, myName);
  }, [code, myName]);

  // Handle slot click in equation row — tap to undo individual placement
  const handleSlotClick = useCallback((slot: 'card1' | 'card2') => {
    const row = rows[activeRow];
    if (row.locked) return;
    if (slot === 'card1' && row.card1 !== null) {
      const sourceKey = placements[`${activeRow}-card1`] || '';
      const newRows = [...rows];
      newRows[activeRow] = { ...row, card1: null, result: null };
      setRows(newRows);
      setPlacements((prev) => { const p = { ...prev }; delete p[`${activeRow}-card1`]; return p; });
      sounds.undo();
      if (connRef.current && code && room?.mode === 'Cooperative') {
        connRef.current.invoke('Clear24Slot', code, myName, activeRow, 'card1', sourceKey).catch(() => {});
      }
      return;
    }
    if (slot === 'card2' && row.card2 !== null) {
      const sourceKey = placements[`${activeRow}-card2`] || '';
      const newRows = [...rows];
      newRows[activeRow] = { ...row, card2: null, result: null };
      setRows(newRows);
      setPlacements((prev) => { const p = { ...prev }; delete p[`${activeRow}-card2`]; return p; });
      sounds.undo();
      if (connRef.current && code && room?.mode === 'Cooperative') {
        connRef.current.invoke('Clear24Slot', code, myName, activeRow, 'card2', sourceKey).catch(() => {});
      }
      return;
    }
  }, [rows, activeRow, placements, code, myName, room?.mode]);

  // ===== Render =====

  if (needsName) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white">Join Room</h1>
            <p className="text-gray-400 mt-2">
              Room code: <span className="font-mono text-blue-400 font-bold">{code}</span>
            </p>
          </div>
          <form onSubmit={handleNameSubmit} className="bg-gray-800 rounded-2xl p-8 border border-gray-700 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Your Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                autoFocus
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
              Join Game
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading game...</p>
        </div>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error || 'Room not found'}</p>
          <button onClick={() => navigate('/games/24')} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  const isCompetitive = room.mode === 'Competitive';
  const isPractice = room.mode === 'Practice';
  const usedSourceKeys = new Set(Object.values(placements));

  return (
    <div className={`min-h-screen transition-colors duration-500 ${getBackgroundClass(visuals.background)}`}>
      {/* Header */}
      <header className="border-b border-gray-800/50 px-2 sm:px-4 py-2 sm:py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <button onClick={() => navigate('/games/24')} className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm flex-shrink-0">
            ← Back
          </button>
          <h1 className="text-white font-bold text-sm sm:text-lg truncate">
            <span className="text-amber-400">24</span> Game
            {isCompetitive && (
              <span className="ml-1 sm:ml-2 text-[10px] sm:text-xs font-medium px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400">⚔️</span>
            )}
            {isPractice && (
              <span className="ml-1 sm:ml-2 text-[10px] sm:text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">🎯</span>
            )}
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <RoomSettings visuals={visuals} onChange={handleVisualsChange} />
            <VideoChat connection={connRef.current} roomCode={code || ''} myName={myName} myColor={myColor} videoPosition={visuals.videoPosition} />
            <span className="text-gray-500 text-xs sm:text-sm items-center gap-1.5 hidden sm:flex">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: myColor }} />
              {myName}
            </span>
          </div>
        </div>
      </header>

      {/* Win Banner */}
      {showWin && (
        <div className="bg-gradient-to-r from-yellow-900/50 via-amber-900/50 to-yellow-900/50 border-b border-yellow-700/50 px-4 py-4">
          <div className="max-w-5xl mx-auto text-center space-y-1">
            <div>
              <span className="text-3xl">🏆</span>
              <span className="text-yellow-300 font-bold text-xl ml-2">
                {showWin === myName ? 'You made 24!' : `${showWin} made 24!`}
              </span>
              <span className="text-3xl ml-2">🏆</span>
            </div>
            <div className="text-amber-200/90 text-lg font-medium animate-bounce">
              {winPhrase}
            </div>
          </div>
        </div>
      )}

      {/* Timer Expired Banner */}
      {timerExpired && !showWin && (
        <div className="bg-gradient-to-r from-red-900/50 via-red-800/50 to-red-900/50 border-b border-red-700/50 px-4 py-3">
          <div className="max-w-5xl mx-auto text-center">
            <span className="text-2xl">⏰</span>
            <span className="text-red-300 font-bold text-lg ml-2">Time&apos;s Up!</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {errorMsg && (
        <div className="bg-red-900/50 border-b border-red-700/50 px-4 py-2">
          <div className="max-w-5xl mx-auto text-center text-red-300 text-sm">{errorMsg}</div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-2 sm:px-4 py-3 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-6 items-start justify-center">
          {/* Main game area */}
          <div className="flex-1 max-w-lg mx-auto w-full">
            {/* Hand info + stopwatch */}
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="text-gray-500 text-xs sm:text-sm">
                <span>Hand #{handNumber}</span>
                {!isPractice && (
                  <>
                    <span className="text-gray-600 mx-1">•</span>
                    <span className="font-mono text-blue-400">{room.code}</span>
                  </>
                )}
              </div>
              <HandStopwatch running={handClockRunning} resetKey={handClockKey} style={visuals.clockStyle} />
            </div>

            {/* ── LAYOUT-AWARE GAME AREA ── */}

            {/* Operator buttons (rendered as a reusable block) */}
            {(() => {
              const operatorButtons = (vertical?: boolean) => (
                <div className={vertical
                  ? 'flex flex-col gap-2 sm:gap-3 justify-center'
                  : 'flex justify-center gap-3 sm:gap-4'
                }>
                  {['+', '-', '*', '/'].map((op) => (
                    <OperatorButton
                      key={op}
                      op={op}
                      selected={rows[activeRow]?.operator === op}
                      onClick={() => placeOperator(op)}
                    />
                  ))}
                </div>
              );

              const cardElements = cards.map((card, i) => {
                const isUsed = usedSourceKeys.has(`card-${i}`);
                const isDealt = i < dealtCount;
                return (
                  <div
                    key={`${i}-${card.number}-${card.suit}`}
                    className={`transition-all duration-300 ${
                      !isDealt
                        ? 'opacity-0 scale-75 translate-y-4'
                        : 'opacity-100 scale-100 translate-y-0'
                    }`}
                  >
                    <PlayingCard
                      card={card}
                      used={isUsed}
                      selected={false}
                      faceDown={faceDown}
                      dealt={isDealt}
                      themeId={themeId}
                      onClick={() => {
                        if (!isUsed) placeNumber(card.number, `card-${i}`);
                      }}
                    />
                  </div>
                );
              });

              const resultCardElements = resultCards.size > 0 ? (
                <div className="flex justify-center gap-2 sm:gap-3">
                  {Array.from(resultCards.entries()).map(([rowIdx, value]) => {
                    const isUsed = usedSourceKeys.has(`result-${rowIdx}`);
                    return (
                      <PlayingCard
                        key={`result-${rowIdx}`}
                        card={{ number: value, suit: 'Results' }}
                        isResult
                        used={isUsed}
                        themeId={themeId}
                        onClick={() => {
                          if (!isUsed) placeNumber(value, `result-${rowIdx}`);
                        }}
                      />
                    );
                  })}
                </div>
              ) : null;

              const feltGradient = getFeltGradient(visuals.feltColor);
              const feltStyle = {
                background: feltGradient,
                backgroundImage: `${feltGradient}, url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.08'/%3E%3C/svg%3E")`,
              };

              const feltOverlay = (
                <div className="absolute inset-0 rounded-2xl sm:rounded-3xl opacity-[0.06] pointer-events-none" style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='%23000'/%3E%3Crect width='1' height='1' fill='%23fff'/%3E%3C/svg%3E")`,
                  backgroundSize: '4px 4px',
                }} />
              );

              const isRow = layout.cardLayout === 'row';
              const opPos = layout.operatorPosition;

              // Cards section inside felt
              const cardsSection = (
                <>
                  {shuffling ? (
                    <ShuffleDeck themeId={themeId} active={shuffling} />
                  ) : (
                    <div className={isRow
                      ? 'flex justify-center gap-2 sm:gap-4 mb-4'
                      : 'grid grid-cols-2 gap-2 sm:gap-3 justify-items-center mb-4 max-w-[200px] sm:max-w-[220px] mx-auto'
                    }>
                      {cardElements}
                    </div>
                  )}
                  {resultCardElements && <div className="mb-3">{resultCardElements}</div>}
                </>
              );

              // Layout: operators on left or right
              if (opPos === 'left' || opPos === 'right') {
                return (
                  <>
                    <div className="flex gap-2 sm:gap-4 items-stretch mb-3 sm:mb-5">
                      {opPos === 'left' && operatorButtons(true)}
                      <div
                        className="relative rounded-xl sm:rounded-3xl p-3 sm:p-6 flex-1 border-3 sm:border-4 border-amber-900/80 shadow-[inset_0_2px_20px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.3)]"
                        style={feltStyle}
                      >
                        {feltOverlay}
                        {cardsSection}
                      </div>
                      {opPos === 'right' && operatorButtons(true)}
                    </div>
                  </>
                );
              }

              // Layout: operators centered (default)
              return (
                <>
                  <div
                    className="relative rounded-xl sm:rounded-3xl p-3 sm:p-6 mb-3 sm:mb-5 border-3 sm:border-4 border-amber-900/80 shadow-[inset_0_2px_20px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.3)]"
                    style={feltStyle}
                  >
                    {feltOverlay}
                    {cardsSection}
                  </div>
                  <div className="mb-3 sm:mb-5">
                    {operatorButtons(false)}
                  </div>
                </>
              );
            })()}

            {/* 3. Equation rows */}
            <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
              {rows.map((row, i) => (
                <EquationRow
                  key={i}
                  row={row}
                  rowIndex={i}
                  isActive={i === activeRow && !showWin && !timerExpired}
                  onSlotClick={handleSlotClick}
                />
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex justify-center gap-2 sm:gap-3 flex-wrap">
              <button
                onClick={undoCurrentRow}
                disabled={!rows[activeRow] || (rows[activeRow].card1 === null && rows[activeRow].operator === null)}
                className="px-3 py-2 sm:px-4 sm:py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-200 text-sm sm:text-base font-medium rounded-lg sm:rounded-xl transition-all"
              >
                ↩ Undo
              </button>
              <button
                onClick={() => {
                  setRows([emptyRow(), emptyRow(), emptyRow()]);
                  setActiveRow(0);
                  setPlacements({});
                  setResultCards(new Map());
                  setErrorMsg('');
                  sounds.undo();
                  // Broadcast full reset in co-op: undo all 3 rows
                  if (connRef.current && code && room?.mode === 'Cooperative') {
                    for (let r = 0; r < 3; r++) {
                      connRef.current.invoke('Undo24', code, myName, r).catch(() => {});
                    }
                  }
                }}
                className="px-3 py-2 sm:px-4 sm:py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm sm:text-base font-medium rounded-lg sm:rounded-xl transition-all"
              >
                🔄 Reset
              </button>
              <button
                onClick={skipHand}
                className="px-3 py-2 sm:px-4 sm:py-3 bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-300 text-sm sm:text-base font-medium rounded-lg sm:rounded-xl transition-all"
              >
                Skip ⏭
              </button>
            </div>
          </div>

          {/* Sidebar — collapsible on mobile */}
          <div className="w-full lg:w-64 flex-shrink-0 space-y-3 sm:space-y-4">
            {isCompetitive && room.timeLimitSeconds && (
              <GameTimer
                connection={connRef.current}
                roomCode={room.code}
                timeLimitSeconds={room.timeLimitSeconds}
                startedAt={room.startedAt}
                onTimerExpired={() => setTimerExpired(true)}
              />
            )}
            <CollapsibleSidebar
              title={isPractice ? '🎯 Practice' : `Players (${room.members.length})`}
              badge={!isPractice ? room.code : undefined}
            >
              <div className="bg-gray-800 rounded-xl sm:rounded-2xl border border-gray-700 p-4 sm:p-6">
                {!isPractice && (
                  <div className="mb-4">
                    <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-1">Room Code</h3>
                    <div className="font-mono text-2xl font-bold text-white tracking-widest text-center py-1">{room.code}</div>
                    <button
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`)}
                      className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      📋 Copy Invite Link
                    </button>
                  </div>
                )}

                {isPractice && (
                  <div className="mb-4 text-center">
                    <div className="text-3xl mb-2">🎯</div>
                    <h3 className="text-white font-bold text-lg">Practice Mode</h3>
                    <p className="text-gray-400 text-sm mt-1">Sharpen your skills solo</p>
                  </div>
                )}

                {Object.keys(scores).length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">
                      {isPractice ? '📊 Your Score' : '🏆 Leaderboard'}
                    </h3>
                    <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
                      {Object.entries(scores)
                        .sort(([, a], [, b]) => b - a)
                        .map(([name, score], idx) => {
                          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                          const isMe = name === myName;
                          return (
                            <div
                              key={name}
                              className={`flex items-center justify-between p-2 rounded-lg transition-all ${
                                isMe ? 'bg-blue-900/30 border border-blue-700/40' : 'bg-gray-700/50'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm w-6 text-center flex-shrink-0">
                                  {medal || <span className="text-gray-500 text-xs">{idx + 1}</span>}
                                </span>
                                <span className={`text-sm font-medium truncate ${isMe ? 'text-blue-300' : 'text-white'}`}>
                                  {name}
                                  {isMe && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="text-amber-400 font-bold text-lg">{score}</span>
                                <span className="text-gray-500 text-xs">pts</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    {handNumber > 1 && (
                      <div className="mt-2 text-center text-gray-500 text-xs">
                        {handNumber - 1} hands played
                      </div>
                    )}
                  </div>
                )}

                {!isPractice && (
                  <div>
                    <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Players ({room.members.length})</h3>
                    <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
                      {room.members.map((member) => (
                        <div key={member.displayName} className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/50">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: member.color }} />
                          <span className="text-white text-sm truncate">
                            {member.displayName}{member.displayName === myName && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-gray-700">
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">How to Play</h3>
                  <div className="text-gray-500 text-xs space-y-1">
                    <p>1. Tap cards &amp; operators — they auto-fill the current row</p>
                    <p>2. Rows auto-lock when complete</p>
                    <p>3. Results become new cards for the next row</p>
                    <p>4. Make <span className="text-amber-400 font-bold">24</span> on the final row to win!</p>
                  </div>
                </div>
              </div>
            </CollapsibleSidebar>
          </div>
        </div>
      </div>
    </div>
  );
}

function calculateResult(a: number, op: string, b: number): number | null {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b >= 0 ? a - b : null;
    case '*': return a * b;
    case '/': return b !== 0 && a % b === 0 ? a / b : null;
    default: return null;
  }
}
