import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startConnection, stopConnection } from '../services/signalr';
import SudokuBoard from '../components/SudokuBoard';
import PlayerList from '../components/PlayerList';
import type { HubConnection } from '@microsoft/signalr';

interface Member {
  displayName: string;
  color: string;
  joinedAt: string;
}

interface RoomData {
  code: string;
  difficulty: string;
  status: string;
  hostName: string;
  initialBoard: number[][];
  currentBoard: number[][];
  solution: number[][];
  members: Member[];
  playerColors: Record<string, string>;
  notes: Record<string, number[]>;
  createdAt: string;
  completedAt: string | null;
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
  const connRef = useRef<HubConnection | null>(null);

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
        localStorage.setItem('sudoku_name', displayName);

        // Connect SignalR
        const conn = await startConnection();
        connRef.current = conn;
        await conn.invoke('JoinRoom', code, displayName);

        // Listen for events
        conn.on('NumberPlaced', (row: number, col: number, value: number, _player: string) => {
          setRoom((prev) => {
            if (!prev) return prev;
            const newBoard = prev.currentBoard.map((r) => [...r]);
            newBoard[row][col] = value;
            const newNotes = { ...prev.notes };
            delete newNotes[`${row},${col}`];
            return { ...prev, currentBoard: newBoard, notes: newNotes };
          });
        });

        conn.on('NumberErased', (row: number, col: number, _player: string) => {
          setRoom((prev) => {
            if (!prev) return prev;
            const newBoard = prev.currentBoard.map((r) => [...r]);
            newBoard[row][col] = 0;
            return { ...prev, currentBoard: newBoard };
          });
        });

        conn.on('PlayerJoined', (_playerName: string) => {
          // Refresh room data to get updated member list
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => (prev ? { ...prev, members: r.members, playerColors: r.playerColors } : prev));
          });
        });

        conn.on('PlayerLeft', (_playerName: string) => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => (prev ? { ...prev, members: r.members } : prev));
          });
        });

        conn.on('NoteUpdated', (row: number, col: number, updatedNotes: number[], _player: string) => {
          setRoom((prev) => {
            if (!prev) return prev;
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
      stopConnection();
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
        return { ...prev, currentBoard: newBoard };
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
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const isCompleted = room.status === 'Completed';

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            &larr; Back
          </button>
          <h1 className="text-white font-bold text-lg">
            <span className="text-blue-400">Sudoku</span> Together
          </h1>
          <div className="text-gray-500 text-sm">
            {myName && (
              <span className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: myColor }}
                />
                {myName}
              </span>
            )}
          </div>
        </div>
      </header>

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
              isCompleted={isCompleted}
            />
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-64 flex-shrink-0">
            <PlayerList
              players={room.members}
              currentPlayer={myName}
              roomCode={room.code}
              difficulty={room.difficulty}
              isCompleted={isCompleted}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
