import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import SudokuBoard from '../components/SudokuBoard';
import PlayerList from '../components/PlayerList';
import VideoChat from '../components/VideoChat';
import GameTimer from '../components/GameTimer';
import SudokuSettings, { getSavedSudokuVisuals, getSudokuBackgroundClass, type SudokuVisuals } from '../components/SudokuSettings';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import type { HubConnection } from '@microsoft/signalr';

interface Member {
  displayName: string;
  color: string;
  joinedAt: string;
}

export interface PlayerProgress {
  displayName: string;
  color: string;
  filledCount: number;
  totalCells: number;
  isCompleted: boolean;
  completedAt: string | null;
  rank: number | null;
}

interface RoomData {
  code: string;
  difficulty: string;
  status: string;
  hostName: string;
  mode: string;
  gameType: string;
  timeLimitSeconds: number | null;
  startedAt: string | null;
  initialBoard: number[][];
  currentBoard: number[][];
  solution: number[][];
  members: Member[];
  playerColors: Record<string, string>;
  notes: Record<string, number[]>;
  createdAt: string;
  completedAt: string | null;
  progress: PlayerProgress[] | null;
  winner: string | null;
}

interface JoinResponse {
  displayName: string;
  color: string;
  room: RoomData;
}

export default function GameRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [myName, setMyName] = useState('');
  const [myColor, setMyColor] = useState('#3B82F6');
  const [loading, setLoading] = useState(true);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState('');
  const [winner, setWinner] = useState<string | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [visuals, setVisuals] = useState<SudokuVisuals>(getSavedSudokuVisuals);
  const connRef = useRef<HubConnection | null>(null);

  const isCompetitive = room?.mode === 'Competitive';

  const joinAndLoad = useCallback(
    async (displayName: string) => {
      if (!code) return;
      try {
        const resp = await api.post<JoinResponse>(`/rooms/${code}/join`, {
          displayName,
        });
        setMyName(resp.displayName);
        setMyColor(resp.color);
        setRoom(resp.room);
        if (resp.room.winner) setWinner(resp.room.winner);
        localStorage.setItem('sudoku_name', displayName);

        // Connect SignalR (use GameHub which has both Sudoku + WebRTC methods)
        const conn = await startGameConnection();
        connRef.current = conn;
        await conn.invoke('JoinRoom', code, displayName);

        // === Cooperative mode events ===
        conn.on('NumberPlaced', (row: number, col: number, value: number, _player: string) => {
          setRoom((prev) => {
            if (!prev || prev.mode === 'Competitive') return prev;
            const newBoard = prev.currentBoard.map((r) => [...r]);
            newBoard[row][col] = value;
            const newNotes = { ...prev.notes };
            delete newNotes[`${row},${col}`];
            return { ...prev, currentBoard: newBoard, notes: newNotes };
          });
        });

        conn.on('NumberErased', (row: number, col: number, _player: string) => {
          setRoom((prev) => {
            if (!prev || prev.mode === 'Competitive') return prev;
            const newBoard = prev.currentBoard.map((r) => [...r]);
            newBoard[row][col] = 0;
            return { ...prev, currentBoard: newBoard };
          });
        });

        conn.on('NoteUpdated', (row: number, col: number, updatedNotes: number[], _player: string) => {
          setRoom((prev) => {
            if (!prev || prev.mode === 'Competitive') return prev;
            const newNotes = { ...prev.notes };
            if (updatedNotes.length > 0) {
              newNotes[`${row},${col}`] = updatedNotes;
            } else {
              delete newNotes[`${row},${col}`];
            }
            return { ...prev, notes: newNotes };
          });
        });

        conn.on('PuzzleCompleted', () => {
          setRoom((prev) => (prev ? { ...prev, status: 'Completed' } : prev));
        });

        // === Competitive mode events ===
        conn.on('ProgressUpdated', (playerName: string, filledCount: number) => {
          setRoom((prev) => {
            if (!prev || !prev.progress) return prev;
            const newProgress = prev.progress.map((p) =>
              p.displayName === playerName ? { ...p, filledCount } : p
            );
            return { ...prev, progress: newProgress };
          });
        });

        conn.on('PlayerFinished', (playerName: string, rank: number) => {
          setRoom((prev) => {
            if (!prev || !prev.progress) return prev;
            const newProgress = prev.progress.map((p) =>
              p.displayName === playerName
                ? { ...p, isCompleted: true, rank, filledCount: 81 }
                : p
            );
            return { ...prev, progress: newProgress };
          });
        });

        conn.on('CompetitionWinner', (playerName: string) => {
          setWinner(playerName);
          setRoom((prev) => (prev ? { ...prev, winner: playerName } : prev));
        });

        // === Shared events ===
        conn.on('PlayerJoined', (_playerName: string) => {
          // Refresh room data to get updated member list
          const savedName = localStorage.getItem('sudoku_name');
          api.get<RoomData>(`/rooms/${code}${savedName ? `?player=${encodeURIComponent(savedName)}` : ''}`).then((r) => {
            setRoom((prev) =>
              prev
                ? { ...prev, members: r.members, playerColors: r.playerColors, progress: r.progress }
                : prev
            );
          });
        });

        conn.on('PlayerLeft', (_playerName: string) => {
          const savedName = localStorage.getItem('sudoku_name');
          api.get<RoomData>(`/rooms/${code}${savedName ? `?player=${encodeURIComponent(savedName)}` : ''}`).then((r) => {
            setRoom((prev) => (prev ? { ...prev, members: r.members } : prev));
          });
        });

        conn.on('RoomClosed', (reason: string) => {
          alert(reason || 'This room has been closed.');
          navigate('/games/sudoku');
        });

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to join room');
        setLoading(false);
      }
    },
    [code]
  );

  useEffect(() => {
    if (!code) {
      navigate('/');
      return;
    }

    const savedName = localStorage.getItem('sudoku_name');
    if (savedName) {
      joinAndLoad(savedName);
    } else {
      setLoading(false);
      setNeedsName(true);
    }

    return () => {
      if (connRef.current) {
        connRef.current.invoke('LeaveRoom', code, myName).catch(() => {});
      }
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

  const handlePlaceNumber = useCallback(
    (row: number, col: number, value: number) => {
      if (!connRef.current || !code) return;
      connRef.current.invoke('PlaceNumber', code, row, col, value, myName);
      // Optimistic update
      setRoom((prev) => {
        if (!prev) return prev;
        const newBoard = prev.currentBoard.map((r) => [...r]);
        newBoard[row][col] = value;
        const newNotes = { ...prev.notes };
        delete newNotes[`${row},${col}`];
        return { ...prev, currentBoard: newBoard, notes: newNotes };
      });
    },
    [code, myName]
  );

  const handleToggleNote = useCallback(
    (row: number, col: number, value: number) => {
      if (!connRef.current || !code) return;
      connRef.current.invoke('ToggleNote', code, row, col, value, myName);
      // Optimistic update
      setRoom((prev) => {
        if (!prev) return prev;
        const newNotes = { ...prev.notes };
        const cellKey = `${row},${col}`;
        const current = new Set(newNotes[cellKey] || []);
        if (current.has(value)) {
          current.delete(value);
        } else {
          current.add(value);
        }
        if (current.size > 0) {
          newNotes[cellKey] = Array.from(current).sort();
        } else {
          delete newNotes[cellKey];
        }
        return { ...prev, notes: newNotes };
      });
    },
    [code, myName]
  );

  const handleCloseRoom = useCallback(async () => {
    if (!connRef.current || !code || !room) return;
    if (!confirm('Close this room? All players will be disconnected.')) return;
    connRef.current.invoke('CloseRoom', code, myName).catch(() => {});
  }, [code, room, myName]);

  const handleEraseNumber = useCallback(
    (row: number, col: number) => {
      if (!connRef.current || !code) return;
      connRef.current.invoke('EraseNumber', code, row, col, myName);
      // Optimistic update
      setRoom((prev) => {
        if (!prev) return prev;
        const newBoard = prev.currentBoard.map((r) => [...r]);
        newBoard[row][col] = 0;
        return { ...prev, currentBoard: newBoard };
      });
    },
    [code, myName]
  );

  // Name entry screen
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
            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
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
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading puzzle...</p>
        </div>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error || 'Room not found'}</p>
          <button
            onClick={() => navigate('/games/sudoku')}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  const isCompleted = room.status === 'Completed' || (isCompetitive && winner !== null) || timerExpired;

  // In competitive mode, you're "done" if YOU finished (but game continues for others)
  const myProgress = room.progress?.find((p) => p.displayName === myName);
  const myBoardCompleted = isCompetitive && (myProgress?.isCompleted || timerExpired);

  return (
    <div className={`min-h-screen transition-colors duration-500 ${getSudokuBackgroundClass(visuals.background)}`}>
      {/* Header */}
      <header className="border-b border-gray-800/50 px-2 sm:px-4 py-2 sm:py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <button
            onClick={() => navigate('/games/sudoku')}
            className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm flex-shrink-0"
          >
            ← Back
          </button>
          <h1 className="text-white font-bold text-sm sm:text-lg truncate">
            <span className="text-blue-400">Sudoku</span> Together
            {isCompetitive && (
              <span className="ml-1 sm:ml-2 text-[10px] sm:text-xs font-medium px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400">
                ⚔️ Race
              </span>
            )}
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <SudokuSettings visuals={visuals} onChange={setVisuals} />
            <VideoChat
              connection={connRef.current}
              roomCode={code || ''}
              myName={myName}
              myColor={myColor}
              videoPosition={visuals.videoPosition}
            />
            <span className="text-gray-500 text-xs sm:text-sm items-center gap-1.5 hidden sm:flex">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: myColor }}
              />
              {myName}
            </span>
          </div>
        </div>
      </header>

      {/* Timer Expired Banner */}
      {isCompetitive && timerExpired && !winner && (
        <div className="bg-gradient-to-r from-red-900/50 via-red-800/50 to-red-900/50 border-b border-red-700/50 px-4 py-3">
          <div className="max-w-7xl mx-auto text-center">
            <span className="text-2xl">⏰</span>
            <span className="text-red-300 font-bold text-lg ml-2">Time&apos;s Up!</span>
            <span className="text-2xl ml-1">⏰</span>
          </div>
        </div>
      )}

      {/* Winner Banner */}
      {isCompetitive && winner && (
        <div className="bg-gradient-to-r from-yellow-900/50 via-amber-900/50 to-yellow-900/50 border-b border-yellow-700/50 px-4 py-3">
          <div className="max-w-7xl mx-auto text-center">
            <span className="text-2xl">🏆</span>
            <span className="text-yellow-300 font-bold text-lg ml-2">
              {winner === myName ? 'You won!' : `${winner} wins!`}
            </span>
            <span className="text-2xl ml-1">🏆</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start justify-center">
          {/* Board */}
          <div className="flex-shrink-0">
            <SudokuBoard
              initialBoard={room.initialBoard}
              currentBoard={room.currentBoard}
              solution={room.solution}
              playerColors={room.playerColors}
              myColor={myColor}
              onPlaceNumber={handlePlaceNumber}
              onEraseNumber={handleEraseNumber}
              onToggleNote={handleToggleNote}
              notes={room.notes || {}}
              isCompleted={isCompetitive ? (myBoardCompleted ?? false) : isCompleted}
              highlightSameNumber={visuals.highlightSameNumber}
              boardSize={visuals.boardSize}
              numberPadStyle={visuals.numberPadStyle}
            />
          </div>

          {/* Sidebar — collapsible on mobile */}
          <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
            {/* Timer always visible */}
            {isCompetitive && room.timeLimitSeconds && (
              <GameTimer
                connection={connRef.current}
                roomCode={room.code}
                timeLimitSeconds={room.timeLimitSeconds}
                startedAt={room.startedAt}
                onTimerExpired={() => setTimerExpired(true)}
              />
            )}
            <CollapsibleSidebar title={`Players (${room.members.length})`} badge={room.code}>
              <PlayerList
                players={room.members}
                currentPlayer={myName}
                roomCode={room.code}
                difficulty={room.difficulty}
                isCompleted={isCompleted}
                mode={room.mode}
                progress={room.progress || undefined}
                winner={winner || undefined}
              />
              {room.hostName === myName && (
                <button
                  onClick={handleCloseRoom}
                  className="w-full mt-3 py-2 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-700/50"
                >
                  🚪 Close Room
                </button>
              )}
            </CollapsibleSidebar>
          </div>
        </div>
      </div>
    </div>
  );
}
