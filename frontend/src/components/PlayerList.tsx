interface Player {
  displayName: string;
  color: string;
  joinedAt: string;
}

interface PlayerListProps {
  players: Player[];
  currentPlayer: string;
  roomCode: string;
  difficulty: string;
  isCompleted: boolean;
}

export default function PlayerList({
  players,
  currentPlayer,
  roomCode,
  difficulty,
  isCompleted,
}: PlayerListProps) {
  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
  };

  const difficultyColor =
    difficulty === 'Easy'
      ? 'text-green-400'
      : difficulty === 'Hard'
      ? 'text-red-400'
      : 'text-yellow-400';

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 w-full">
      {/* Room Info */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Room Code</h3>
          <button
            onClick={copyCode}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            title="Copy invite code"
          >
            Copy
          </button>
        </div>
        <div className="font-mono text-3xl font-bold text-white tracking-widest text-center py-2">
          {roomCode}
        </div>
        <div className="text-center mt-1">
          <span className={`text-sm font-medium ${difficultyColor}`}>{difficulty}</span>
        </div>
      </div>

      {isCompleted && (
        <div className="mb-6 bg-green-900/30 border border-green-700 rounded-xl p-4 text-center">
          <div className="text-3xl mb-1">&#127881;</div>
          <p className="text-green-400 font-bold text-lg">Puzzle Solved!</p>
          <p className="text-green-300/70 text-sm">Great teamwork!</p>
        </div>
      )}

      {/* Players */}
      <div>
        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
          Players ({players.length})
        </h3>
        <div className="space-y-2">
          {players.map((player) => (
            <div
              key={player.displayName}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-700/50"
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: player.color }}
              />
              <span className="text-white text-sm font-medium truncate">
                {player.displayName}
                {player.displayName === currentPlayer && (
                  <span className="text-gray-400 text-xs ml-1">(you)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Share */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-gray-500 text-xs text-center">
          Share the room code with friends to play together!
        </p>
      </div>
    </div>
  );
}
