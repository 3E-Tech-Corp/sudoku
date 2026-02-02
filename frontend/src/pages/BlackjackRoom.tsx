import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import { sounds } from '../services/sounds';
import VideoChat from '../components/VideoChat';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { getThemeById } from '../config/deckThemes';
import type { HubConnection } from '@microsoft/signalr';

// ===== Types =====

interface BlackjackCard {
  rank: number; // 1=A, 2-10, 11=J, 12=Q, 13=K
  suit: string; // Hearts, Diamonds, Clubs, Spades
}

interface BlackjackPlayer {
  playerName: string;
  cards: BlackjackCard[];
  bet: number;
  chips: number;
  status: string; // Waiting, Playing, Standing, Bust, Blackjack, Won, Lost, Push
  insuranceBet: number;
}

interface BlackjackState {
  id: number;
  roomId: number;
  dealerHand: BlackjackCard[];
  dealerRevealed: boolean;
  phase: string; // Betting, Playing, DealerTurn, Payout
  currentPlayerIndex: number;
  players: BlackjackPlayer[];
}

interface Member {
  displayName: string;
  color: string;
  joinedAt: string;
}

interface RoomData {
  code: string;
  status: string;
  hostName: string;
  mode: string;
  gameType: string;
  members: Member[];
  playerColors: Record<string, string>;
  blackjackState: BlackjackState | null;
}

interface JoinResponse {
  displayName: string;
  color: string;
  room: RoomData;
}

// ===== Helpers =====

function cardValue(card: BlackjackCard): string {
  if (card.rank === 1) return 'A';
  if (card.rank === 11) return 'J';
  if (card.rank === 12) return 'Q';
  if (card.rank === 13) return 'K';
  return String(card.rank);
}

function handValue(cards: BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 1) { total += 11; aces++; }
    else if (c.rank >= 11) total += 10;
    else total += c.rank;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function handStr(cards: BlackjackCard[]): string {
  if (!cards || cards.length === 0) return '0';
  const val = handValue(cards);
  // Check for soft hand (ace counted as 11)
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 1) { total += 11; aces++; }
    else if (c.rank >= 11) total += 10;
    else total += c.rank;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  if (aces > 0 && total <= 21 && total !== val) return `${val}`;
  return String(val);
}

// ===== Card Component =====

function BJCard({ card, faceDown, themeId }: {
  card: BlackjackCard;
  faceDown?: boolean;
  themeId?: string;
}) {
  const theme = getThemeById(themeId || 'classic');
  const sizeClass = 'w-[64px] h-[90px] sm:w-[80px] sm:h-[112px]';

  return (
    <div className={`${sizeClass} [perspective:400px] flex-shrink-0`}>
      <div
        className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: faceDown ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* Front */}
        <div className="absolute inset-0 [backface-visibility:hidden] rounded-lg border-2 border-gray-300 bg-white overflow-hidden shadow-md">
          <img
            src={theme.cardUrl(card.rank, card.suit)}
            alt={`${cardValue(card)} of ${card.suit}`}
            className="w-full h-full object-contain"
            style={theme.imgFilter ? { filter: theme.imgFilter } : undefined}
            draggable={false}
          />
        </div>
        {/* Back */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-lg border-2 border-blue-700 overflow-hidden shadow-md">
          <img src={theme.backUrl} alt="Card back" className="w-full h-full object-fill" draggable={false} />
        </div>
      </div>
    </div>
  );
}

// ===== Hand Display =====

function HandDisplay({ cards, label, value, status, themeId, isDealer, dealerRevealed }: {
  cards: BlackjackCard[];
  label: string;
  value?: string;
  status?: string;
  themeId?: string;
  isDealer?: boolean;
  dealerRevealed?: boolean;
}) {
  const statusColor = {
    Blackjack: 'text-yellow-400',
    Won: 'text-green-400',
    Bust: 'text-red-400',
    Lost: 'text-red-400',
    Push: 'text-blue-400',
    Standing: 'text-gray-400',
    Playing: 'text-white',
  }[status || ''] || 'text-gray-400';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-sm font-medium text-gray-400">{label}</div>
      <div className="flex gap-1 sm:gap-1.5">
        {cards.map((card, i) => (
          <div key={i} className="transition-all duration-300" style={{ marginLeft: i > 0 ? '-12px' : '0' }}>
            <BJCard
              card={card}
              faceDown={isDealer && !dealerRevealed && i === 1}
              themeId={themeId}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {value && (
          <span className="text-white font-bold text-lg">{value}</span>
        )}
        {status && status !== 'Waiting' && status !== 'Playing' && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor} bg-gray-800/80`}>
            {status === 'Blackjack' ? '🂡 Blackjack!' : status}
          </span>
        )}
      </div>
    </div>
  );
}

// ===== Chip Selector =====

const BET_AMOUNTS = [10, 25, 50, 100, 250, 500];

function ChipSelector({ chips, onBet, disabled, t }: {
  chips: number;
  onBet: (amount: number) => void;
  disabled: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [selected, setSelected] = useState(25);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-gray-400 text-sm">
        {t('blackjack.yourChips')} <span className="text-yellow-400 font-bold">${chips.toLocaleString()}</span>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {BET_AMOUNTS.map((amt) => (
          <button
            key={amt}
            onClick={() => setSelected(amt)}
            disabled={amt > chips}
            className={`w-14 h-14 rounded-full text-xs font-bold transition-all shadow-lg flex items-center justify-center ${
              selected === amt
                ? 'bg-yellow-500 text-black scale-110 ring-2 ring-yellow-300'
                : amt > chips
                ? 'bg-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-600 text-white hover:bg-gray-500 active:scale-95'
            }`}
          >
            ${amt}
          </button>
        ))}
      </div>
      <button
        onClick={() => onBet(selected)}
        disabled={disabled || selected > chips}
        className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl transition-all text-lg"
      >
        {t('blackjack.placeBet', { amount: selected })}
      </button>
    </div>
  );
}

// ===== Main Component =====

export default function BlackjackRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [myName, setMyName] = useState('');
  const [myColor, setMyColor] = useState('#10B981');
  const [loading, setLoading] = useState(true);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState('');
  const [gameState, setGameState] = useState<BlackjackState | null>(null);
  const connRef = useRef<HubConnection | null>(null);

  const themeId = 'classic';

  // Find my player in the game state
  const myPlayer = gameState?.players.find((p) => p.playerName === myName);
  const isMyTurn = gameState?.phase === 'Playing' && gameState.players[gameState.currentPlayerIndex]?.playerName === myName;

  const joinAndLoad = useCallback(
    async (displayName: string) => {
      if (!code) return;
      try {
        const resp = await api.post<JoinResponse>(`/rooms/${code}/join`, { displayName });
        setMyName(resp.displayName);
        setMyColor(resp.color);
        setRoom(resp.room);
        if (resp.room.blackjackState) {
          setGameState(resp.room.blackjackState);
        }
        localStorage.setItem('sudoku_name', displayName);

        const conn = await startGameConnection();
        connRef.current = conn;
        await conn.invoke('JoinRoom', code, displayName);

        conn.on('BJStateUpdated', (stateJson: string) => {
          const state: BlackjackState = JSON.parse(stateJson);
          setGameState(state);
        });

        conn.on('PlayerJoined', () => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members, playerColors: r.playerColors } : prev);
          });
        });

        conn.on('PlayerLeft', () => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members } : prev);
          });
        });

        conn.on('RoomClosed', (reason: string) => {
          alert(reason || t('gameRoom.roomClosed'));
          navigate('/games/blackjack');
        });

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to join room');
        setLoading(false);
      }
    },
    [code, navigate]
  );

  useEffect(() => {
    if (!code) { navigate('/'); return; }
    const savedName = localStorage.getItem('sudoku_name');
    if (savedName) {
      joinAndLoad(savedName);
    } else {
      setLoading(false);
      setNeedsName(true);
    }
    return () => {
      if (connRef.current) {
        connRef.current.invoke('LeaveRoom', code, localStorage.getItem('sudoku_name') || '').catch(() => {});
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

  // ===== Game Actions =====

  const placeBet = useCallback((amount: number) => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJPlaceBet', code, myName, amount).catch(console.error);
    sounds.cardPlace();
  }, [code, myName]);

  const hit = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJHit', code, myName).catch(console.error);
    sounds.deal();
  }, [code, myName]);

  const stand = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJStand', code, myName).catch(console.error);
  }, [code, myName]);

  const doubleDown = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJDoubleDown', code, myName).catch(console.error);
    sounds.deal();
  }, [code, myName]);

  const dealCards = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJDealCards', code).catch(console.error);
    sounds.shuffle();
  }, [code]);

  const newRound = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('BJNewRound', code).catch(console.error);
  }, [code]);

  const handleCloseRoom = useCallback(async () => {
    if (!connRef.current || !code || !room) return;
    if (!confirm(t('common.closeRoomConfirm'))) return;
    connRef.current.invoke('CloseRoom', code, myName).catch(() => {});
  }, [code, room, myName, t]);

  // ===== Render =====

  if (needsName) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🂡</div>
            <h1 className="text-3xl font-bold text-white">{t('blackjack.joinTable')}</h1>
            <p className="text-gray-400 mt-2">{t('gameRoom.roomCodeLabel')} <span className="font-mono text-emerald-400 font-bold">{code}</span></p>
          </div>
          <form onSubmit={handleNameSubmit} className="bg-gray-800 rounded-2xl p-8 border border-gray-700 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">{t('common.yourName')}</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={t('common.enterName')}
                maxLength={20}
                autoFocus
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors">
              {t('blackjack.sitDown')}
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
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{t('blackjack.shuffling')}</p>
        </div>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error || t('common.roomNotFound')}</p>
          <button onClick={() => navigate('/games/blackjack')} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
            {t('common.backToLobby')}
          </button>
        </div>
      </div>
    );
  }

  const phase = gameState?.phase || 'Betting';
  const isHost = room.hostName === myName;
  const allBetsPlaced = gameState?.players.every((p) => p.bet > 0) ?? false;
  const dealerCards = gameState?.dealerHand || [];
  const dealerVal = gameState?.dealerRevealed
    ? handStr(dealerCards)
    : dealerCards.length > 0 ? cardValue(dealerCards[0]) : '?';

  return (
    <div className="min-h-screen bg-[#0a1a0a] transition-colors duration-500">
      {/* Header */}
      <header className="border-b border-gray-800/50 px-2 sm:px-4 py-2 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <button onClick={() => navigate('/games/blackjack')} className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm flex-shrink-0">
            {t('common.back')}
          </button>
          <h1 className="text-white font-bold text-sm sm:text-lg truncate">
            <span className="text-emerald-400">{t('blackjack.title')}</span> {t('blackjack.table')}
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <LanguageSwitcher />
            <VideoChat connection={connRef.current} roomCode={code || ''} myName={myName} myColor={myColor} />
            <span className="text-gray-500 text-xs sm:text-sm items-center gap-1.5 hidden sm:flex">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: myColor }} />
              {myName}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-6 items-start justify-center">
          {/* Main game area */}
          <div className="flex-1 max-w-2xl mx-auto w-full">
            {/* Felt table */}
            <div
              className="relative rounded-2xl sm:rounded-3xl p-4 sm:p-8 border-4 border-amber-900/80 shadow-[inset_0_2px_20px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.3)] min-h-[400px]"
              style={{
                background: 'radial-gradient(ellipse at center, #2d7a3a 0%, #1e6b2a 40%, #165a22 100%)',
              }}
            >
              {/* Dealer area */}
              <div className="text-center mb-8">
                {dealerCards.length > 0 ? (
                  <HandDisplay
                    cards={dealerCards}
                    label={t('blackjack.dealer')}
                    value={dealerVal}
                    isDealer
                    dealerRevealed={gameState?.dealerRevealed}
                    themeId={themeId}
                    status={gameState?.dealerRevealed && handValue(dealerCards) > 21 ? 'Bust' : undefined}
                  />
                ) : (
                  <div className="text-gray-300/50 text-sm py-8">{t('blackjack.waitingForBets')}</div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 my-4" />

              {/* Player hands */}
              <div className="flex flex-wrap justify-center gap-4 sm:gap-8">
                {gameState?.players.map((player, idx) => {
                  const isCurrentTurn = phase === 'Playing' && idx === gameState.currentPlayerIndex;
                  const isMe = player.playerName === myName;
                  return (
                    <div
                      key={player.playerName}
                      className={`flex flex-col items-center p-3 rounded-xl transition-all ${
                        isCurrentTurn ? 'ring-2 ring-yellow-400 bg-yellow-900/20' : ''
                      } ${isMe ? 'bg-white/5' : ''}`}
                    >
                      <HandDisplay
                        cards={player.cards}
                        label={`${player.playerName}${isMe ? ' ' + t('common.you') : ''}`}
                        value={player.cards.length > 0 ? handStr(player.cards) : undefined}
                        status={player.status}
                        themeId={themeId}
                      />
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        {player.bet > 0 && (
                          <span className="bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full font-bold">
                            Bet: ${player.bet}
                          </span>
                        )}
                        <span className="text-gray-400">
                          💰 ${player.chips.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* No players yet */}
              {(!gameState || gameState.players.length === 0) && (
                <div className="text-center text-gray-300/50 py-8">
                  {t('blackjack.waitingForPlayers')}
                </div>
              )}
            </div>

            {/* Action area */}
            <div className="mt-4 sm:mt-6">
              {/* Betting phase */}
              {phase === 'Betting' && myPlayer && myPlayer.bet === 0 && (
                <ChipSelector chips={myPlayer.chips} onBet={placeBet} disabled={false} t={t} />
              )}

              {phase === 'Betting' && myPlayer && myPlayer.bet > 0 && (
                <div className="text-center py-4">
                  <div className="text-emerald-400 font-medium">
                    {t('blackjack.betPlaced')} <span className="text-yellow-400 font-bold">${myPlayer.bet}</span>
                  </div>
                  <p className="text-gray-500 text-sm mt-1">{t('blackjack.waitingOtherPlayers')}</p>
                </div>
              )}

              {/* Host deal button */}
              {phase === 'Betting' && isHost && allBetsPlaced && gameState && gameState.players.length > 0 && (
                <div className="text-center mt-4">
                  <button
                    onClick={dealCards}
                    className="px-10 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xl rounded-2xl transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-95"
                  >
                    {t('blackjack.dealCards')}
                  </button>
                </div>
              )}

              {/* Playing phase — action buttons */}
              {phase === 'Playing' && isMyTurn && myPlayer && (
                <div className="flex justify-center gap-3 flex-wrap">
                  <button
                    onClick={hit}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all active:scale-95 text-lg"
                  >
                    {t('blackjack.hit')}
                  </button>
                  <button
                    onClick={stand}
                    className="px-8 py-3 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-xl transition-all active:scale-95 text-lg"
                  >
                    {t('blackjack.stand')}
                  </button>
                  {myPlayer.cards.length === 2 && myPlayer.chips >= myPlayer.bet && (
                    <button
                      onClick={doubleDown}
                      className="px-8 py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-all active:scale-95 text-lg"
                    >
                      {t('blackjack.double')}
                    </button>
                  )}
                </div>
              )}

              {/* Waiting for others */}
              {phase === 'Playing' && !isMyTurn && (
                <div className="text-center py-4">
                  <p className="text-gray-400">
                    {t('blackjack.waitingFor', { name: gameState?.players[gameState.currentPlayerIndex]?.playerName })}
                  </p>
                </div>
              )}

              {/* Dealer turn */}
              {phase === 'DealerTurn' && (
                <div className="text-center py-4">
                  <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-gray-400">{t('blackjack.dealerPlaying')}</p>
                </div>
              )}

              {/* Payout — show results and new round button */}
              {phase === 'Payout' && (
                <div className="text-center py-4 space-y-4">
                  <div className="space-y-1">
                    {gameState?.players.map((p) => {
                      const icon = p.status === 'Won' || p.status === 'Blackjack' ? '🎉' : p.status === 'Push' ? '🤝' : '💸';
                      const color = p.status === 'Won' || p.status === 'Blackjack' ? 'text-green-400' : p.status === 'Push' ? 'text-blue-400' : 'text-red-400';
                      return (
                        <div key={p.playerName} className={`text-sm ${color} font-medium`}>
                          {icon} {p.playerName}: {p.status} {p.status === 'Won' || p.status === 'Blackjack' ? `(+$${p.bet})` : p.status === 'Push' ? '(returned)' : `(-$${p.bet})`}
                        </div>
                      );
                    })}
                  </div>
                  {isHost && (
                    <button
                      onClick={newRound}
                      className="px-10 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all text-lg"
                    >
                      {t('blackjack.newRound')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-64 flex-shrink-0 space-y-3">
            <CollapsibleSidebar title={t('common.playersCount', { count: room.members.length })} badge={room.code}>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-4">
                <div>
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-1">Room Code</h3>
                  <div className="font-mono text-2xl font-bold text-white tracking-widest text-center py-1">{room.code}</div>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`)}
                    className="mt-2 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    📋 Copy Invite Link
                  </button>
                </div>

                {/* Chip standings */}
                {gameState && gameState.players.length > 0 && (
                  <div>
                    <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">💰 Chip Standings</h3>
                    <div className="space-y-1">
                      {[...gameState.players]
                        .sort((a, b) => b.chips - a.chips)
                        .map((p, idx) => {
                          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                          const isMe = p.playerName === myName;
                          return (
                            <div
                              key={p.playerName}
                              className={`flex items-center justify-between p-2 rounded-lg ${
                                isMe ? 'bg-emerald-900/30 border border-emerald-700/40' : 'bg-gray-700/50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm w-6 text-center">{medal || ''}</span>
                                <span className={`text-sm font-medium ${isMe ? 'text-emerald-300' : 'text-white'}`}>
                                  {p.playerName}{isMe ? ' (you)' : ''}
                                </span>
                              </div>
                              <span className="text-yellow-400 font-bold">${p.chips.toLocaleString()}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Players list */}
                <div>
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">At the Table</h3>
                  <div className="space-y-1">
                    {room.members.map((member) => (
                      <div key={member.displayName} className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/50">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: member.color }} />
                        <span className="text-white text-sm truncate">
                          {member.displayName}
                          {member.displayName === myName && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                          {member.displayName === room.hostName && <span className="text-yellow-400 text-xs ml-1">👑</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-700">
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">How to Play</h3>
                  <div className="text-gray-500 text-xs space-y-1">
                    <p>1. Place your bet with chips</p>
                    <p>2. Get dealt 2 cards — try to reach <span className="text-emerald-400 font-bold">21</span></p>
                    <p>3. <strong>Hit</strong> for more cards, <strong>Stand</strong> to hold</p>
                    <p>4. <strong>Double</strong> to double bet + get 1 card</p>
                    <p>5. Beat the dealer without going over 21!</p>
                  </div>
                </div>

                {isHost && (
                  <button
                    onClick={handleCloseRoom}
                    className="w-full py-2 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-700/50"
                  >
                    🚪 Close Table
                  </button>
                )}
              </div>
            </CollapsibleSidebar>
          </div>
        </div>
      </div>
    </div>
  );
}
