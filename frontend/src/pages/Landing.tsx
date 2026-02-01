import { useNavigate } from 'react-router-dom';

const GAMES = [
  {
    id: 'sudoku',
    name: 'Sudoku',
    icon: '🔢',
    gradient: 'from-blue-600 via-blue-700 to-indigo-800',
    hoverGradient: 'hover:from-blue-500 hover:via-blue-600 hover:to-indigo-700',
    border: 'border-blue-500/30',
    description: 'Classic 9×9 number puzzle',
    longDesc: 'Fill every row, column, and 3×3 box with the numbers 1 through 9. Cooperate with friends or race to finish first.',
    features: ['Easy, Medium, Hard', 'Co-op & Competitive', 'Real-time multiplayer'],
  },
  {
    id: '24',
    name: '24 Card Game',
    icon: '🃏',
    gradient: 'from-amber-600 via-orange-700 to-red-800',
    hoverGradient: 'hover:from-amber-500 hover:via-orange-600 hover:to-red-700',
    border: 'border-amber-500/30',
    description: 'Make 24 from 4 cards',
    longDesc: 'Deal 4 cards and combine them using +, −, ×, ÷ to make exactly 24. Three equations, one goal. Race your friends!',
    features: ['Playing card deck', 'Step-by-step equations', 'Score tracking'],
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    icon: '🂡',
    gradient: 'from-emerald-600 via-green-700 to-teal-800',
    hoverGradient: 'hover:from-emerald-500 hover:via-green-600 hover:to-teal-700',
    border: 'border-emerald-500/30',
    description: 'Classic casino card game',
    longDesc: 'Beat the dealer by getting as close to 21 as possible without going over. Hit, stand, or double down!',
    features: ['Multiplayer tables', 'Virtual chips', 'Real card dealing'],
  },
  {
    id: 'chess',
    name: 'Chess',
    icon: '♟️',
    gradient: 'from-slate-600 via-gray-700 to-zinc-800',
    hoverGradient: 'hover:from-slate-500 hover:via-gray-600 hover:to-zinc-700',
    border: 'border-slate-500/30',
    description: 'The classic strategy game',
    longDesc: 'The ultimate game of strategy. Checkmate your opponent in this timeless battle of wits. Full rules including castling, en passant, and promotion.',
    features: ['1v1 multiplayer', 'Full move validation', 'Castling & en passant'],
  },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-extrabold text-white mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-amber-400 bg-clip-text text-transparent">
              Games
            </span>{' '}
            Together
          </h1>
          <p className="text-gray-400 text-xl">Pick a game. Invite friends. Play in real-time.</p>
        </div>

        {/* Game Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
          {GAMES.map((game) => (
            <button
              key={game.id}
              onClick={() => navigate(`/games/${game.id}`)}
              className={`
                group relative overflow-hidden rounded-3xl p-8 text-left transition-all duration-300
                bg-gradient-to-br ${game.gradient} ${game.hoverGradient}
                border ${game.border}
                hover:scale-[1.03] hover:shadow-2xl hover:shadow-black/40
                active:scale-[0.98]
              `}
            >
              {/* Background decoration */}
              <div className="absolute top-0 right-0 w-32 h-32 opacity-10 text-[120px] leading-none pointer-events-none select-none -translate-y-4 translate-x-4 group-hover:translate-x-2 transition-transform duration-300">
                {game.icon}
              </div>

              <div className="relative z-10">
                <div className="text-5xl mb-4">{game.icon}</div>
                <h2 className="text-2xl font-bold text-white mb-2">{game.name}</h2>
                <p className="text-white/70 text-sm mb-5">{game.longDesc}</p>

                <div className="flex flex-wrap gap-2 mb-6">
                  {game.features.map((f) => (
                    <span
                      key={f}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/80 backdrop-blur-sm"
                    >
                      {f}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-white font-semibold group-hover:gap-3 transition-all">
                  <span>Play Now</span>
                  <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm">
          No account needed. Just pick a game, create a room, and share the code.
        </p>
      </div>
    </div>
  );
}
