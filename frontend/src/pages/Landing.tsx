import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface CreateRoomResponse {
  code: string;
  difficulty: string;
}

interface PublicRoom {
  code: string;
  difficulty: string;
  hostName: string;
  playerCount: number;
  createdAt: string;
}

export default function Landing() {
  const navigate = useNavigate();
  const [hostName, setHostName] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [isPublic, setIsPublic] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    api.get<PublicRoom[]>('/rooms/public')
      .then(setPublicRooms)
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, []);

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
        difficulty,
        hostName: hostName.trim(),
        isPublic,
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

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-3">
            <span className="text-blue-400">Sudoku</span> Together
          </h1>
          <p className="text-gray-400 text-lg">Solve puzzles cooperatively with friends in real-time</p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm text-center">
            {error}
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
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-lg transition-colors"
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
          </div>
        </div>

        {/* Public Rooms */}
        {!loadingRooms && publicRooms.length > 0 && (
          <div className="max-w-3xl mx-auto mt-12">
            <h2 className="text-xl font-bold text-white mb-4 text-center">🌐 Public Rooms</h2>
            <div className="grid gap-3">
              {publicRooms.map((room) => {
                const diffColor =
                  room.difficulty === 'Easy'
                    ? 'text-green-400 bg-green-900/30'
                    : room.difficulty === 'Hard'
                    ? 'text-red-400 bg-red-900/30'
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
                        // Scroll to join form
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between hover:border-blue-500/50 hover:bg-gray-750 transition-all text-left"
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-lg font-bold text-blue-400">{room.code}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${diffColor}`}>
                        {room.difficulty}
                      </span>
                      <span className="text-gray-400 text-sm">
                        by {room.hostName || 'Anonymous'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400">
                      <span className="text-sm">👥 {room.playerCount}</span>
                      <span className="text-blue-400 text-sm font-medium">Join →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-center text-gray-500 text-sm mt-10">
          No account needed. Just create or join a room and start solving!
        </p>
      </div>
    </div>
  );
}
