import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import { sounds } from '../services/sounds';
import VideoChat from '../components/VideoChat';
import GameTimer from '../components/GameTimer';
import DeckPicker from '../components/DeckPicker';
import { getSavedThemeId, saveThemeId, getThemeById } from '../config/deckThemes';
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
}: {
  card: TwentyFourCard | { number: number; suit: string };
  selected?: boolean;
  used?: boolean;
  isResult?: boolean;
  onClick?: () => void;
  animDelay?: number;
  faceDown?: boolean;
  themeId?: string;
}) {
  const theme = getThemeById(themeId || 'classic');
  const isRealCard = card.suit === 'Hearts' || card.suit === 'Diamonds' || card.suit === 'Clubs' || card.suit === 'Spades';

  return (
    <button
      onClick={onClick}
      disabled={used || faceDown}
      className={`
        relative w-20 h-28 sm:w-[88px] sm:h-[124px] rounded-xl border-2 transition-all duration-300 flex items-center justify-center overflow-hidden
        ${faceDown
          ? 'border-blue-700 cursor-default shadow-md'
          : selected
          ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)] scale-105 bg-white'
          : used
          ? 'border-gray-600 opacity-40 cursor-not-allowed bg-gray-700'
          : isResult
          ? 'border-amber-400 hover:border-amber-300 hover:shadow-lg cursor-pointer bg-gradient-to-b from-amber-50 to-amber-100'
          : 'border-gray-300 hover:border-blue-400 hover:shadow-lg cursor-pointer active:scale-95 bg-white'
        }
      `}
      style={{ animationDelay: animDelay ? `${animDelay}ms` : undefined }}
    >
      {faceDown ? (
        <img
          src={theme.backUrl}
          alt="Card back"
          className="w-full h-full object-fill rounded-lg"
          draggable={false}
        />
      ) : isRealCard ? (
        <>
          <img
            src={theme.cardUrl(card.number, card.suit)}
            alt={`${card.number} of ${card.suit}`}
            className="w-full h-full object-contain rounded-lg"
            style={theme.imgFilter ? { filter: theme.imgFilter } : undefined}
            draggable={false}
          />
          {isResult && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow">
              <span className="text-[9px] text-white font-bold">R</span>
            </div>
          )}
        </>
      ) : (
        /* Result card (intermediate value) */
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-amber-100 rounded-lg">
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {card.number}
          </div>
          <div className="text-xs text-amber-600 font-medium mt-1">Result</div>
          {isResult && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow">
              <span className="text-[9px] text-white font-bold">R</span>
            </div>
          )}
        </div>
      )}
    </button>
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
        min-w-[48px] min-h-[48px] w-14 h-14 sm:w-16 sm:h-16 rounded-2xl text-2xl sm:text-3xl font-bold transition-all
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
      flex items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl transition-all
      ${row.locked
        ? 'bg-green-900/20 border border-green-700/30'
        : isActive
        ? 'bg-gray-700/50 border border-blue-500/30'
        : 'bg-gray-800/50 border border-gray-700/30 opacity-50'
      }
    `}>
      <span className="text-gray-500 text-xs w-4 flex-shrink-0">R{rowIndex + 1}</span>

      {/* Card 1 slot */}
      <button
        onClick={() => !row.locked && isActive && onSlotClick('card1')}
        disabled={row.locked || !isActive}
        className={`
          w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-lg font-bold transition-all
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

      {/* Operator slot — display only (filled by tapping operator buttons above) */}
      <div
        className={`
          w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center text-xl font-bold
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
          w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-lg font-bold transition-all
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
      <span className="text-gray-400 text-xl font-bold">=</span>

      {/* Result */}
      <div className={`
        w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-lg font-bold
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

  // Deck theme (persisted in localStorage via deckThemes helper)
  const [themeId, setThemeId] = useState(getSavedThemeId);
  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  // Game state
  const [cards, setCards] = useState<TwentyFourCard[]>([]);
  const [rows, setRows] = useState<RowState[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [activeRow, setActiveRow] = useState(0);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [resultCards, setResultCards] = useState<Map<number, number>>(new Map());
  const [handNumber, setHandNumber] = useState(1);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [showWin, setShowWin] = useState<string | null>(null);
  const [dealing, setDealing] = useState(false);
  const [faceDown, setFaceDown] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [timerExpired, setTimerExpired] = useState(false);

  // Reset game state for new hand
  const resetForNewHand = useCallback((newCards: TwentyFourCard[]) => {
    setCards(newCards);
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setActiveRow(0);
    setPlacements({});
    setResultCards(new Map());
    setErrorMsg('');
    setShowWin(null);
    setFaceDown(true);
    setDealing(true);

    setTimeout(() => { setDealing(false); }, 300);
    setTimeout(() => { setFaceDown(false); sounds.flip(); }, 800);
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
          setCards(parsedCards);
          setHandNumber(gs.handNumber);
          setScores(parsedScores);
          setFaceDown(true);
          setDealing(true);
          setTimeout(() => setDealing(false), 300);
          setTimeout(() => { setFaceDown(false); sounds.flip(); }, 800);
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
          setShowWin(winnerName);
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
          setTimeout(() => { setShowWin(null); resetForNewHand(newCards); sounds.shuffle(); }, 2000);
        });

        conn.on('24HandSkipped', (_player: string) => {});

        conn.on('24RowCompleted', (_player: string, row: number, card1: number, op: string, card2: number, result: number) => {
          setRows((prev) => { const n = [...prev]; n[row] = { card1, operator: op, card2, result, locked: true }; return n; });
          setResultCards((prev) => new Map(prev).set(row, result));
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
    setPlacements((prev) => ({ ...prev, [slotKey]: sourceKey }));

    // Auto-calculate and auto-lock when all 3 slots filled
    if (newRow.card1 !== null && newRow.card2 !== null && newRow.operator !== null) {
      const result = calculateResult(newRow.card1, newRow.operator, newRow.card2);
      if (result !== null && result > 0 && Number.isInteger(result)) {
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
        setErrorMsg('Result must be a positive whole number. Try different numbers or operator.');
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

    // Auto-calculate and auto-lock when all 3 slots filled
    if (newRow.card1 !== null && newRow.card2 !== null) {
      const result = calculateResult(newRow.card1, op, newRow.card2);
      if (result !== null && result > 0 && Number.isInteger(result)) {
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
        setErrorMsg('Result must be a positive whole number. Try a different operator.');
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
  }, [rows, activeRow]);

  // Skip hand
  const skipHand = useCallback(() => {
    if (connRef.current && code) connRef.current.invoke('Skip24Hand', code, myName);
  }, [code, myName]);

  // Handle slot click in equation row — tap to undo individual placement
  const handleSlotClick = useCallback((slot: 'card1' | 'card2') => {
    const row = rows[activeRow];
    if (row.locked) return;
    if (slot === 'card1' && row.card1 !== null) {
      const newRows = [...rows];
      newRows[activeRow] = { ...row, card1: null, result: null };
      setRows(newRows);
      setPlacements((prev) => { const p = { ...prev }; delete p[`${activeRow}-card1`]; return p; });
      sounds.undo();
      return;
    }
    if (slot === 'card2' && row.card2 !== null) {
      const newRows = [...rows];
      newRows[activeRow] = { ...row, card2: null, result: null };
      setRows(newRows);
      setPlacements((prev) => { const p = { ...prev }; delete p[`${activeRow}-card2`]; return p; });
      sounds.undo();
      return;
    }
  }, [rows, activeRow]);

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
  const usedSourceKeys = new Set(Object.values(placements));

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/games/24')} className="text-gray-400 hover:text-white transition-colors text-sm">
            &larr; Back
          </button>
          <h1 className="text-white font-bold text-lg">
            <span className="text-amber-400">24</span> Card Game
            {isCompetitive && (
              <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded bg-orange-900/30 text-orange-400">⚔️ Race</span>
            )}
          </h1>
          <div className="flex items-center gap-3">
            <DeckPicker currentThemeId={themeId} onChange={handleThemeChange} />
            <VideoChat connection={connRef.current} roomCode={code || ''} myName={myName} myColor={myColor} />
            <span className="text-gray-500 text-sm flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: myColor }} />
              {myName}
            </span>
          </div>
        </div>
      </header>

      {/* Win Banner */}
      {showWin && (
        <div className="bg-gradient-to-r from-yellow-900/50 via-amber-900/50 to-yellow-900/50 border-b border-yellow-700/50 px-4 py-4">
          <div className="max-w-5xl mx-auto text-center">
            <span className="text-3xl">🏆</span>
            <span className="text-yellow-300 font-bold text-xl ml-2">
              {showWin === myName ? 'You made 24!' : `${showWin} made 24!`}
            </span>
            <span className="text-3xl ml-2">🎉</span>
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

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          {/* Main game area */}
          <div className="flex-1 max-w-lg mx-auto w-full">
            {/* Hand info */}
            <div className="text-center mb-4">
              <span className="text-gray-500 text-sm">Hand #{handNumber}</span>
              <span className="text-gray-600 mx-2">•</span>
              <span className="text-gray-500 text-sm">Room: <span className="font-mono text-blue-400">{room.code}</span></span>
            </div>

            {/* ── NEW LAYOUT ── */}

            {/* 1. Dealt cards at top */}
            <div className="flex justify-center gap-3 sm:gap-4 mb-4">
              {cards.map((card, i) => {
                const isUsed = usedSourceKeys.has(`card-${i}`);
                return (
                  <div
                    key={`${i}-${card.number}-${card.suit}`}
                    className={`transition-all duration-500 ${dealing ? 'opacity-0 translate-y-8' : 'opacity-100 translate-y-0'}`}
                    style={{ transitionDelay: `${i * 100}ms` }}
                  >
                    <PlayingCard
                      card={card}
                      used={isUsed}
                      selected={false}
                      faceDown={faceDown}
                      themeId={themeId}
                      onClick={() => {
                        if (!isUsed) placeNumber(card.number, `card-${i}`);
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Result cards from completed rows */}
            {resultCards.size > 0 && (
              <div className="flex justify-center gap-3 mb-4">
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
            )}

            {/* 2. Operator buttons — large, touch-friendly, always visible between cards and rows */}
            <div className="flex justify-center gap-4 mb-5">
              {['+', '-', '*', '/'].map((op) => (
                <OperatorButton
                  key={op}
                  op={op}
                  selected={rows[activeRow]?.operator === op}
                  onClick={() => placeOperator(op)}
                />
              ))}
            </div>

            {/* 3. Equation rows */}
            <div className="space-y-3 mb-6">
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
            <div className="flex justify-center gap-3 flex-wrap">
              <button
                onClick={undoCurrentRow}
                disabled={!rows[activeRow] || (rows[activeRow].card1 === null && rows[activeRow].operator === null)}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-200 font-medium rounded-xl transition-all"
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
                }}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-xl transition-all"
              >
                🔄 Reset
              </button>
              <button
                onClick={skipHand}
                className="px-4 py-3 bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-300 font-medium rounded-xl transition-all"
              >
                Skip ⏭
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
            {isCompetitive && room.timeLimitSeconds && (
              <GameTimer
                connection={connRef.current}
                roomCode={room.code}
                timeLimitSeconds={room.timeLimitSeconds}
                startedAt={room.startedAt}
                onTimerExpired={() => setTimerExpired(true)}
              />
            )}
            <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
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

              {Object.keys(scores).length > 0 && (
                <div className="mb-4">
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Scores</h3>
                  <div className="space-y-1">
                    {Object.entries(scores)
                      .sort(([, a], [, b]) => b - a)
                      .map(([name, score], idx) => (
                        <div key={name} className="flex items-center justify-between p-2 rounded-lg bg-gray-700/50">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  '}</span>
                            <span className="text-white text-sm font-medium">
                              {name}{name === myName && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                            </span>
                          </div>
                          <span className="text-amber-400 font-bold">{score}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Players ({room.members.length})</h3>
                <div className="space-y-1">
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
          </div>
        </div>
      </div>
    </div>
  );
}

function calculateResult(a: number, op: string, b: number): number | null {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b > 0 ? a - b : null;
    case '*': return a * b;
    case '/': return b !== 0 && a % b === 0 && a / b > 0 ? a / b : null;
    default: return null;
  }
}
