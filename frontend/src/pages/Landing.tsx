import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface CreateRoomResponse {
  code: string;
  difficulty: string;
}

export default function Landing() {
  const navigate = useNavigate();
  const [hostName, setHostName] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

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

        <p className="text-center text-gray-500 text-sm mt-10">
          No account needed. Just create or join a room and start solving!
        </p>
      </div>
    </div>
  );
}
