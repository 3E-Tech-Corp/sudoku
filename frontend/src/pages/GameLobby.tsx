import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

interface CreateRoomResponse {
  code: string;
  difficulty: string;
  gameType: string;
}

interface PublicRoom {
  code: string;
  difficulty: string;
  hostName: string;
  mode: string;
  gameType: string;
  playerCount: number;
  createdAt: string;
}

const GAME_CONFIG: Record<string, {
  apiGameType: string;
  name: string;
  icon: string;
  accent: string;
  accentBg: string;
  buttonClass: string;
  hasDifficulty: boolean;
  tagline: string;
}> = {
  sudoku: {
    apiGameType: 'Sudoku',
    name: 'Sudoku',
    icon: '🔢',
    accent: 'text-blue-400',
    accentBg: 'bg-blue-600',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800',
    hasDifficulty: true,
    tagline: 'Solve puzzles with friends — cooperate or compete in real-time',
  },
  '24': {
    apiGameType: 'TwentyFour',
    name: '24 Card Game',
    icon: '🃏',
    accent: 'text-amber-400',
    accentBg: 'bg-amber-600',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800',
    hasDifficulty: false,
    tagline: 'Combine 4 cards to make 24 — race your friends!',
  },
};

export default function GameLobby() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  const config = gameId ? GAME_CONFIG[gameId] : null;

  const [hostName, setHostName] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [mode, setMode] = useState('Cooperative');
  const [timeLimitSeconds, setTimeLimitSeconds] = useState<number | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [startingPractice, setStartingPractice] = useState(false);
  const [error, setError] = useState('');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  // Pre-fill names from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sudoku_name');
    if (saved) {
      setHostName(saved);
      setJoinName(saved);
    }
  }, []);

  useEffect(() => {
    if (!config) return;
    setLoadingRooms(true);
    api.get<PublicRoom[]>(`/rooms/public?gameType=${config.apiGameType}`)
      .then(setPublicRooms)
      .catch(() => setPublicRooms([]))
      .finally(() => setLoadingRooms(false));
  }, [config]);

  if (!config) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">Unknown game type</p>
          <button onClick={() => navigate('/')} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  const handlePractice = async () => {
    const savedName = localStorage.getItem('sudoku_name') || 'Player';
    setError('');
    setStartingPractice(true);
    try {
      const resp = await api.post<CreateRoomResponse>('/rooms', {
        difficulty: 'N/A',
        hostName: savedName,
        isPublic: false,
        mode: 'Practice',
        gameType: config!.apiGameType,
      });
      localStorage.setItem('sudoku_name', savedName);
      navigate(`/room/${resp.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start practice');
    } finally {
      setStartingPractice(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError('');
    setCreating(true);
    try {
      const resp = await api.post<CreateRoomResponse>('/rooms', {
        difficulty: config.hasDifficulty ? difficulty : 'N/A',
        hostName: hostName.trim(),
        isPublic,
        mode,
        gameType: config.apiGameType,
        timeLimitSeconds: mode === 'Competitive' ? timeLimitSeconds : null,
      });
      localStorage.setItem('sudoku_name', hostName.trim());
      navigate(`/room/${resp.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !joinName.trim()) {
      setError('Please enter both code and name');
      return;
    }
    setError('');
    setJoining(true);
    try {
      await api.post(`/rooms/${joinCode.trim().toUpperCase()}/join`, {
        displayName: joinName.trim(),
      });
      localStorage.setItem('sudoku_name', joinName.trim());
      navigate(`/room/${joinCode.trim().toUpperCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    } finally {
      setJoining(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="min-h-screen bg-gray-900 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <button
            onClick={() => navigate('/')}
            className="text-gray-500 hover:text-gray-300 transition-colors text-sm mb-6 inline-flex items-center gap-1"
          >
            ← All Games
          </button>
          <div className="text-center">
            <div className="text-5xl mb-3">{config.icon}</div>
            <h1 className="text-4xl font-bold text-white mb-2">
              <span className={config.accent}>{config.name}</span>
            </h1>
            <p className="text-gray-400 text-lg">{config.tagline}</p>
          </div>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {/* Quick Practice Button */}
        {gameId === '24' && (
          <div className="max-w-3xl mx-auto mb-8">
            <button
              onClick={handlePractice}
              disabled={startingPractice}
              className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-emerald-800 disabled:to-teal-800 text-white font-bold text-lg rounded-2xl transition-all shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center gap-3"
            >
              <span className="text-2xl">🎯</span>
              {startingPractice ? 'Starting...' : 'Practice Solo'}
              <span className="text-sm font-normal opacity-75 ml-1">— no room needed</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {/* Create Room */}
          <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Create Room</h2>
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Your Name</label>
                <input
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={20}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Difficulty (Sudoku only) */}
              {config.hasDifficulty && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Difficulty</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Easy', 'Medium', 'Hard'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDifficulty(d)}
                        className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                          difficulty === d
                            ? d === 'Easy'
                              ? 'bg-green-600 text-white ring-2 ring-green-400'
                              : d === 'Medium'
                              ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                              : 'bg-red-600 text-white ring-2 ring-red-400'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      value: 'Cooperative',
                      label: '🤝 Co-op',
                      desc: gameId === '24' ? 'Solve together' : 'Solve together',
                    },
                    {
                      value: 'Competitive',
                      label: '⚔️ Race',
                      desc: gameId === '24' ? 'First to 24 wins' : 'First to finish',
                    },
                  ].map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(m.value)}
                      className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex flex-col items-center ${
                        mode === m.value
                          ? m.value === 'Cooperative'
                            ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                            : 'bg-orange-600 text-white ring-2 ring-orange-400'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      <span>{m.label}</span>
                      <span className="text-[10px] opacity-70 mt-0.5">{m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Limit (competitive only) */}
              {mode === 'Competitive' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">⏱ Time Limit</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { value: null, label: 'None' },
                      { value: 300, label: '5m' },
                      { value: 600, label: '10m' },
                      { value: 900, label: '15m' },
                      { value: 1800, label: '30m' },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setTimeLimitSeconds(opt.value)}
                        className={`py-2 px-2 rounded-lg text-xs font-medium transition-all ${
                          timeLimitSeconds === opt.value
                            ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPublic(!isPublic)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isPublic ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isPublic ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-300">Public room</span>
              </div>

              <button
                type="submit"
                disabled={creating}
                className={`w-full py-3 text-white font-medium rounded-lg transition-colors ${config.buttonClass}`}
              >
                {creating ? 'Creating...' : 'Create Game'}
              </button>
            </form>
          </div>

          {/* Join Room */}
          <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Join Room</h2>
            <form onSubmit={handleJoin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Your Name</label>
                <input
                  type="text"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={20}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Room Code</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="e.g. ABC123"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-widest text-center text-lg font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={joining}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 text-white font-medium rounded-lg transition-colors"
              >
                {joining ? 'Joining...' : 'Join Game'}
              </button>
            </form>

            {/* How to play section (fills space in 24 game where there's no difficulty) */}
            {gameId === '24' && (
              <div className="mt-8 pt-6 border-t border-gray-700">
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">How to Play</h3>
                <div className="space-y-2 text-gray-500 text-sm">
                  <p className="flex items-start gap-2"><span className="text-amber-400">1.</span> Four cards are dealt (numbers 1–13)</p>
                  <p className="flex items-start gap-2"><span className="text-amber-400">2.</span> Combine them using +, −, ×, ÷</p>
                  <p className="flex items-start gap-2"><span className="text-amber-400">3.</span> Build 3 equations — final result must be <span className="text-amber-400 font-bold">24</span></p>
                  <p className="flex items-start gap-2"><span className="text-amber-400">4.</span> All intermediate results must be non-negative integers (0 is OK!)</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Public Rooms */}
        <div className="max-w-3xl mx-auto mt-12">
          <h2 className="text-xl font-bold text-white mb-4 text-center">
            🌐 Public Rooms
          </h2>
          {loadingRooms ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-3 border-gray-600 border-t-gray-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Loading rooms...</p>
            </div>
          ) : publicRooms.length === 0 ? (
            <div className="text-center py-8 bg-gray-800/50 rounded-2xl border border-gray-700/50">
              <p className="text-gray-500">No public rooms right now</p>
              <p className="text-gray-600 text-sm mt-1">Create one and toggle "Public room" to list it here!</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {publicRooms.map((room) => {
                const diffColor =
                  room.difficulty === 'Easy'
                    ? 'text-green-400 bg-green-900/30'
                    : room.difficulty === 'Hard'
                    ? 'text-red-400 bg-red-900/30'
                    : room.difficulty === 'N/A'
                    ? 'text-amber-400 bg-amber-900/30'
                    : 'text-yellow-400 bg-yellow-900/30';
                return (
                  <button
                    key={room.code}
                    onClick={() => {
                      const name = localStorage.getItem('sudoku_name');
                      if (name) {
                        navigate(`/room/${room.code}`);
                      } else {
                        setJoinCode(room.code);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between hover:border-blue-500/50 hover:bg-gray-750 transition-all text-left"
                  >
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="font-mono text-lg font-bold text-blue-400">{room.code}</span>
                      {room.difficulty !== 'N/A' && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${diffColor}`}>
                          {room.difficulty}
                        </span>
                      )}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        room.mode === 'Competitive'
                          ? 'text-orange-400 bg-orange-900/30'
                          : 'text-blue-400 bg-blue-900/30'
                      }`}>
                        {room.mode === 'Competitive' ? '⚔️ Race' : '🤝 Co-op'}
                      </span>
                      <span className="text-gray-400 text-sm">
                        by {room.hostName || 'Anonymous'}
                      </span>
                      <span className="text-gray-600 text-xs">{timeAgo(room.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400 flex-shrink-0">
                      <span className="text-sm">👥 {room.playerCount}</span>
                      <span className="text-blue-400 text-sm font-medium">Join →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-center text-gray-600 text-sm mt-10">
          No account needed. Just create or join a room and start playing!
        </p>
      </div>
    </div>
  );
}
