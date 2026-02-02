import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import GameRoom from './GameRoom';
import TwentyFourRoom from './TwentyFourRoom';
import BlackjackRoom from './BlackjackRoom';
import ChessRoom from './ChessRoom';
import GuandanRoom from './GuandanRoom';

interface RoomInfo {
  code: string;
  gameType: string;
}

export default function GameRouter() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [gameType, setGameType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) {
      navigate('/');
      return;
    }

    api.get<RoomInfo>(`/rooms/${code.toUpperCase()}`)
      .then((room) => {
        setGameType(room.gameType);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Room not found');
        setLoading(false);
      });
  }, [code, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  if (gameType === 'TwentyFour') {
    return <TwentyFourRoom />;
  }

  if (gameType === 'Blackjack') {
    return <BlackjackRoom />;
  }

  if (gameType === 'Chess') {
    return <ChessRoom />;
  }

  if (gameType === 'Guandan') {
    return <GuandanRoom />;
  }

  // Default: Sudoku
  return <GameRoom />;
}
