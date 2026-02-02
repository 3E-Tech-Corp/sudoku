import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../services/api';
import LanguageSwitcher from '../components/LanguageSwitcher';

const GAMES = [
  {
    id: 'sudoku',
    icon: '🔢',
    gradient: 'from-blue-600 via-blue-700 to-indigo-800',
    hoverGradient: 'hover:from-blue-500 hover:via-blue-600 hover:to-indigo-700',
    border: 'border-blue-500/30',
    soloAccent: 'text-blue-300 hover:text-blue-200',
    apiGameType: 'Sudoku',
  },
  {
    id: '24',
    icon: '🃏',
    gradient: 'from-amber-600 via-orange-700 to-red-800',
    hoverGradient: 'hover:from-amber-500 hover:via-orange-600 hover:to-red-700',
    border: 'border-amber-500/30',
    soloAccent: 'text-amber-300 hover:text-amber-200',
    apiGameType: 'TwentyFour',
  },
  {
    id: 'blackjack',
    icon: '🂡',
    gradient: 'from-emerald-600 via-green-700 to-teal-800',
    hoverGradient: 'hover:from-emerald-500 hover:via-green-600 hover:to-teal-700',
    border: 'border-emerald-500/30',
    soloAccent: 'text-emerald-300 hover:text-emerald-200',
    apiGameType: 'Blackjack',
  },
  {
    id: 'chess',
    icon: '♟️',
    gradient: 'from-slate-600 via-gray-700 to-zinc-800',
    hoverGradient: 'hover:from-slate-500 hover:via-gray-600 hover:to-zinc-700',
    border: 'border-slate-500/30',
    soloAccent: 'text-slate-300 hover:text-slate-200',
    apiGameType: 'Chess',
  },
  {
    id: 'guandan',
    icon: '🥚',
    gradient: 'from-red-600 via-rose-700 to-pink-800',
    hoverGradient: 'hover:from-red-500 hover:via-rose-600 hover:to-pink-700',
    border: 'border-red-500/30',
    soloAccent: 'text-red-300 hover:text-red-200',
    apiGameType: 'Guandan',
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const startSolo = async (game: typeof GAMES[0], e: React.MouseEvent) => {
    e.stopPropagation();
    if (loadingId) return;
    setLoadingId(game.id);

    try {
      const name = localStorage.getItem('sudoku_name') || 'Player';
      const resp = await api.post<{ code: string }>('/rooms', {
        hostName: name,
        gameType: game.apiGameType,
        difficulty: game.id === 'sudoku' ? 'Medium' : undefined,
        mode: 'Cooperative',
      });
      navigate(`/room/${resp.code}`);
    } catch (err) {
      console.error('Failed to create solo room:', err);
      navigate(`/games/${game.id}`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4 py-12 relative">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-extrabold text-white mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-amber-400 bg-clip-text text-transparent">
              {t('landing.gamesTitle')}
            </span>{' '}
            {t('landing.together')}
          </h1>
          <p className="text-gray-400 text-xl">{t('landing.subtitle')}</p>
        </div>

        {/* Game Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
          {GAMES.map((game) => {
            const name = t(`landing.games.${game.id}.name`);
            const longDesc = t(`landing.games.${game.id}.longDesc`);
            const features = t(`landing.games.${game.id}.features`, { returnObjects: true }) as string[];

            return (
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
                  <h2 className="text-2xl font-bold text-white mb-2">{name}</h2>
                  <p className="text-white/70 text-sm mb-5">{longDesc}</p>

                  <div className="flex flex-wrap gap-2 mb-6">
                    {features.map((f) => (
                      <span
                        key={f}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/80 backdrop-blur-sm"
                      >
                        {f}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold group-hover:gap-3 transition-all">
                      <span>{t('landing.playNow')}</span>
                      <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
                    </div>
                    <span
                      onClick={(e) => startSolo(game, e)}
                      className={`text-xs font-medium ${game.soloAccent} opacity-70 hover:opacity-100 transition-opacity underline underline-offset-2 cursor-pointer`}
                    >
                      {loadingId === game.id ? t('common.starting') : t('landing.practiceSolo')}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm">
          {t('landing.footer')}
        </p>
      </div>
    </div>
  );
}
