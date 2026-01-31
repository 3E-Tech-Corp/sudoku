import type { PlayerProgress } from '../pages/GameRoom';

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
  mode?: string;
  progress?: PlayerProgress[];
  winner?: string;
}

export default function PlayerList({
  players,
  currentPlayer,
  roomCode,
  difficulty,
  isCompleted,
  mode = 'Cooperative',
  progress,
  winner,
}: PlayerListProps) {
  const shareLink = `${window.location.origin}/room/${roomCode}`;
  const isCompetitive = mode === 'Competitive';

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
  };

  const difficultyColor =
    difficulty === 'Easy'
      ? 'text-green-400'
      : difficulty === 'Hard'
      ? 'text-red-400'
      : 'text-yellow-400';

  // Sort progress: completed players by rank first, then by filledCount desc
  const sortedProgress = progress
    ? [...progress].sort((a, b) => {
        if (a.isCompleted && !b.isCompleted) return -1;
        if (!a.isCompleted && b.isCompleted) return 1;
        if (a.isCompleted && b.isCompleted) return (a.rank || 0) - (b.rank || 0);
        return b.filledCount - a.filledCount;
      })
    : [];

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 w-full">
      {/* Room Info */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Room Code</h3>
          {isCompetitive && (
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-orange-900/30 text-orange-400">
              ⚔️ Race
            </span>
          )}
        </div>
        <div className="font-mono text-3xl font-bold text-white tracking-widest text-center py-2">
          {roomCode}
        </div>
        <div className="text-center mt-1">
          <span className={`text-sm font-medium ${difficultyColor}`}>{difficulty}</span>
        </div>
        <button
          onClick={copyLink}
          className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          📋 Copy Invite Link
        </button>
      </div>

      {/* Cooperative Completed */}
      {!isCompetitive && isCompleted && (
        <div className="mb-6 bg-green-900/30 border border-green-700 rounded-xl p-4 text-center">
          <div className="text-3xl mb-1">&#127881;</div>
          <p className="text-green-400 font-bold text-lg">Puzzle Solved!</p>
          <p className="text-green-300/70 text-sm">Great teamwork!</p>
        </div>
      )}

      {/* Competitive Winner Banner */}
      {isCompetitive && winner && (
        <div className="mb-6 bg-gradient-to-b from-yellow-900/40 to-amber-900/20 border border-yellow-700/50 rounded-xl p-4 text-center">
          <div className="text-3xl mb-1">🏆</div>
          <p className="text-yellow-300 font-bold text-lg">
            {winner === currentPlayer ? 'You Won!' : `${winner} Wins!`}
          </p>
          <p className="text-yellow-300/60 text-sm">First to solve the puzzle</p>
        </div>
      )}

      {/* Players / Progress */}
      <div>
        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
          {isCompetitive ? 'Progress' : 'Players'} ({players.length})
        </h3>
        <div className="space-y-2">
          {isCompetitive && sortedProgress.length > 0
            ? sortedProgress.map((player) => {
                const percentage = Math.round((player.filledCount / player.totalCells) * 100);
                const isMe = player.displayName === currentPlayer;
                const rankEmoji =
                  player.rank === 1
                    ? '🥇'
                    : player.rank === 2
                    ? '🥈'
                    : player.rank === 3
                    ? '🥉'
                    : player.rank
                    ? `#${player.rank}`
                    : null;

                return (
                  <div
                    key={player.displayName}
                    className={`p-3 rounded-lg ${
                      player.isCompleted
                        ? 'bg-green-900/20 border border-green-700/30'
                        : 'bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: player.color }}
                        />
                        <span className="text-white text-sm font-medium truncate">
                          {player.displayName}
                          {isMe && (
                            <span className="text-gray-400 text-xs ml-1">(you)</span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {player.isCompleted && rankEmoji && (
                          <span className="text-sm">{rankEmoji}</span>
                        )}
                        <span
                          className={`text-xs font-mono ${
                            player.isCompleted ? 'text-green-400' : 'text-gray-400'
                          }`}
                        >
                          {percentage}%
                        </span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-2 bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          player.isCompleted
                            ? 'bg-green-500'
                            : isMe
                            ? 'bg-blue-500'
                            : 'bg-gray-400'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    {player.isCompleted && (
                      <div className="mt-1.5 text-xs text-green-400/70">
                        ✅ Finished{rankEmoji ? ` — ${rankEmoji}` : ''}
                      </div>
                    )}
                  </div>
                );
              })
            : players.map((player) => (
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
          {isCompetitive
            ? 'Share the invite link — race to solve the puzzle first!'
            : 'Share the invite link with friends to play together!'}
        </p>
      </div>
    </div>
  );
}
