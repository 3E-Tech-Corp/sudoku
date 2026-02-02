import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import type { HubConnection } from '@microsoft/signalr';
import { getThemeById } from '../config/deckThemes';

// ===== Types =====

interface GuandanCard {
  rank: number;  // 2-14 (2-A), 16=BlackJoker, 17=RedJoker
  suit: string;  // Hearts, Diamonds, Clubs, Spades, Black, Red (jokers)
}

interface GuandanPlayerView {
  name: string;
  team: string;
  seatIndex: number;
  cardsRemaining: number;
  isFinished: boolean;
  finishOrder: number;
  hand: GuandanCard[] | null;
  isBot: boolean;
  lastPlayCards: GuandanCard[] | null;
}

interface GuandanState {
  id: number;
  roomId: number;
  phase: string;
  currentPlayerIndex: number;
  lastPlayerIndex: number;
  currentPlay: GuandanCard[];
  currentPlayType: string;
  teamALevel: number;
  teamBLevel: number;
  roundNumber: number;
  players: GuandanPlayerView[];
  finishOrder: string[];
  dealerIndex: number;
  consecutivePasses: number;
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
  guandanState: GuandanState | null;
}

interface JoinResponse {
  displayName: string;
  color: string;
  room: RoomData;
}

// ===== Helpers =====

const theme = getThemeById('classic');

function rankToThemeNumber(rank: number): number {
  // rank 14 = A → theme number 1
  if (rank === 14) return 1;
  // rank 2-13 → theme number 2-13
  return rank;
}

function suitToThemeSuit(suit: string): string {
  // Suit names match the theme: Hearts, Diamonds, Clubs, Spades
  return suit;
}

function levelToString(level: number): string {
  if (level === 14) return 'A';
  if (level === 13) return 'K';
  if (level === 12) return 'Q';
  if (level === 11) return 'J';
  return String(level);
}

function cardSortKey(card: GuandanCard, levelRank: number): number {
  let r = card.rank;
  if (r === levelRank && r < 16) r = 15; // Level cards above A
  return r * 10 + (card.suit === 'Spades' ? 4 : card.suit === 'Hearts' ? 3 : card.suit === 'Diamonds' ? 2 : card.suit === 'Clubs' ? 1 : 0);
}

function cardKey(card: GuandanCard, idx: number): string {
  return `${card.rank}-${card.suit}-${idx}`;
}

function isWild(card: GuandanCard, levelRank: number): boolean {
  return card.rank === levelRank && card.suit === 'Hearts';
}

// ===== Card Component (Real SVG Images) =====

function GDCard({ card, selected, onClick, levelRank, small }: {
  card: GuandanCard;
  selected?: boolean;
  onClick?: () => void;
  levelRank: number;
  small?: boolean;
}) {
  const isJoker = card.rank >= 16;
  const wild = isWild(card, levelRank);

  const w = small ? 40 : 48;
  const h = small ? 56 : 67;

  if (isJoker) {
    // Custom joker rendering (no SVG files for jokers)
    const isRed = card.rank === 17;
    return (
      <div
        onClick={onClick}
        style={{ width: w, height: h }}
        className={`
          rounded-md border-2 flex flex-col items-center justify-center cursor-pointer
          transition-all duration-150 select-none flex-shrink-0
          bg-gradient-to-b from-gray-100 to-gray-200
          ${selected ? '-translate-y-3 border-yellow-400 shadow-lg shadow-yellow-400/30' : 'border-gray-400 hover:border-gray-300'}
        `}
      >
        <span className={`text-lg ${isRed ? '' : ''}`}>{isRed ? '🃏' : '🃏'}</span>
        <span className={`text-[8px] font-bold ${isRed ? 'text-red-600' : 'text-gray-800'}`}>
          {isRed ? 'RED' : 'BLK'}
        </span>
      </div>
    );
  }

  const num = rankToThemeNumber(card.rank);
  const suit = suitToThemeSuit(card.suit);
  const imgSrc = theme.cardUrl(num, suit);

  return (
    <div
      onClick={onClick}
      style={{ width: w, height: h }}
      className={`
        rounded-md overflow-hidden cursor-pointer transition-all duration-150 select-none flex-shrink-0 relative
        ${selected ? '-translate-y-3 ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : 'hover:brightness-110'}
        ${wild ? 'ring-2 ring-amber-400 shadow-md shadow-amber-400/40' : ''}
      `}
    >
      <img
        src={imgSrc}
        alt={`${card.rank} of ${card.suit}`}
        className="w-full h-full object-cover"
        draggable={false}
      />
      {wild && (
        <div className="absolute inset-0 rounded-md ring-2 ring-amber-400/80 pointer-events-none" />
      )}
    </div>
  );
}

// ===== Compact Card Display (for played cards near other players) =====

function MiniCards({ cards, levelRank }: { cards: GuandanCard[]; levelRank: number }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="flex -space-x-3 justify-center">
      {cards.map((card, i) => (
        <GDCard key={cardKey(card, i)} card={card} levelRank={levelRank} small />
      ))}
    </div>
  );
}

// ===== Card Back Component =====
function CardBack({ count, small }: { count: number; small?: boolean }) {
  const w = small ? 'w-7 h-10' : 'w-9 h-12';
  return (
    <div className="flex items-center gap-1">
      <div className={`${w} rounded-md bg-gradient-to-br from-red-700 to-red-900 border border-red-600 flex items-center justify-center`}>
        <span className="text-yellow-300 text-[10px] font-bold">🥚</span>
      </div>
      <span className="text-gray-400 text-xs font-mono">×{count}</span>
    </div>
  );
}

// ===== Main Component =====

export default function GuandanRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const connRef = useRef<HubConnection | null>(null);

  const [room, setRoom] = useState<RoomData | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [gameState, setGameState] = useState<GuandanState | null>(null);
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [aiThinking, setAiThinking] = useState<string | null>(null);
  const [joinName, setJoinName] = useState('');
  const [joining, setJoining] = useState(false);
  const [needsJoin, setNeedsJoin] = useState(false);

  // Load room data
  const loadRoom = useCallback(async () => {
    if (!code) return;
    try {
      const savedName = localStorage.getItem('sudoku_name') || '';
      const roomData = await api.get<RoomData>(`/rooms/${code.toUpperCase()}`);
      setRoom(roomData);

      const isMember = roomData.members.some(m => m.displayName === savedName);
      if (isMember) {
        setDisplayName(savedName);
        if (roomData.guandanState) {
          setGameState(roomData.guandanState);
        }
      } else {
        setNeedsJoin(true);
        setJoinName(savedName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room');
    }
  }, [code]);

  useEffect(() => { loadRoom(); }, [loadRoom]);

  // SignalR connection
  useEffect(() => {
    if (!code || !displayName) return;

    let mounted = true;

    const connect = async () => {
      try {
        const conn = await startGameConnection();
        if (!mounted) return;
        connRef.current = conn;

        conn.on('GDStateUpdated', (stateJson: string) => {
          try {
            const state = JSON.parse(stateJson) as GuandanState;
            setGameState(state);
            setSelectedCards([]);
            setActionError('');
            setAiThinking(null);
          } catch { /* ignore parse errors */ }
        });

        conn.on('GDError', (msg: string) => {
          setActionError(msg);
          setTimeout(() => setActionError(''), 3000);
        });

        conn.on('GDAiThinking', (botName: string) => {
          setAiThinking(botName);
        });

        conn.on('PlayerJoined', () => { loadRoom(); });
        conn.on('PlayerLeft', () => { loadRoom(); });
        conn.on('RoomClosed', () => { navigate('/'); });

        await conn.invoke('JoinRoom', code.toUpperCase(), displayName);
      } catch (err) {
        console.error('SignalR connect failed:', err);
      }
    };

    connect();

    return () => {
      mounted = false;
      if (connRef.current) {
        connRef.current.invoke('LeaveRoom', code!.toUpperCase(), displayName).catch(() => {});
        stopGameConnection();
        connRef.current = null;
      }
    };
  }, [code, displayName, navigate, loadRoom]);

  // Join handler
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinName.trim() || !code) return;
    setJoining(true);
    try {
      const resp = await api.post<JoinResponse>(`/rooms/${code.toUpperCase()}/join`, {
        displayName: joinName.trim(),
      });
      localStorage.setItem('sudoku_name', joinName.trim());
      setDisplayName(joinName.trim());
      setRoom(resp.room);
      setNeedsJoin(false);
      if (resp.room.guandanState) {
        setGameState(resp.room.guandanState);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  // Game actions
  const fillBots = () => {
    connRef.current?.invoke('GuandanFillBots', code!.toUpperCase()).catch(console.error);
  };

  const startRound = () => {
    connRef.current?.invoke('GuandanStartRound', code!.toUpperCase()).catch(console.error);
  };

  const playCards = () => {
    if (!gameState || selectedCards.length === 0) return;
    const myPlayer = gameState.players.find(p => p.name === displayName);
    if (!myPlayer?.hand) return;

    const cards = selectedCards.map(i => myPlayer.hand![i]);
    const cardsJson = JSON.stringify(cards);
    connRef.current?.invoke('GuandanPlayCards', code!.toUpperCase(), displayName, cardsJson).catch(console.error);
  };

  const pass = () => {
    connRef.current?.invoke('GuandanPass', code!.toUpperCase(), displayName).catch(console.error);
  };

  const toggleCard = (index: number) => {
    setSelectedCards(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  // Get player positions relative to current player
  const getRelativePositions = () => {
    if (!gameState) return { bottom: null, top: null, left: null, right: null };

    const myIdx = gameState.players.findIndex(p => p.name === displayName);
    if (myIdx < 0) {
      // Spectator mode
      return {
        bottom: gameState.players[0] || null,
        right: gameState.players[1] || null,
        top: gameState.players[2] || null,
        left: gameState.players[3] || null,
      };
    }

    const p = gameState.players;
    return {
      bottom: p[myIdx] || null,
      right: p[(myIdx + 1) % 4] || null,
      top: p[(myIdx + 2) % 4] || null,
      left: p[(myIdx + 3) % 4] || null,
    };
  };

  // ===== Render =====

  // Join form
  if (needsJoin) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🥚</div>
            <h1 className="text-2xl font-bold text-white">Join Guandan</h1>
            <p className="text-gray-400 mt-1">Room: <span className="text-red-400 font-mono">{code}</span></p>
          </div>
          {error && <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}
          <form onSubmit={handleJoin} className="space-y-4">
            <input
              type="text"
              value={joinName}
              onChange={e => setJoinName(e.target.value)}
              placeholder="Your name"
              maxLength={20}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              type="submit"
              disabled={joining || !joinName.trim()}
              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white font-medium rounded-lg transition-colors"
            >
              {joining ? 'Joining...' : 'Join Game'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button onClick={() => navigate('/')} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  if (!room || !gameState) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading game...</p>
        </div>
      </div>
    );
  }

  const positions = getRelativePositions();
  const myPlayer = gameState.players.find(p => p.name === displayName);
  const myTeam = myPlayer?.team || 'A';
  const myLevelRank = myTeam === 'A' ? gameState.teamALevel : gameState.teamBLevel;
  const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.name === displayName;
  const currentPlayerName = gameState.players[gameState.currentPlayerIndex]?.name || '';
  const isLeading = gameState.currentPlay.length === 0;

  // Sort hand by effective rank
  const sortedHand = myPlayer?.hand
    ? [...myPlayer.hand].map((c, i) => ({ card: c, origIdx: i }))
        .sort((a, b) => cardSortKey(a.card, myLevelRank) - cardSortKey(b.card, myLevelRank))
    : [];

  const canPlay = gameState.phase === 'Playing' && isMyTurn && selectedCards.length > 0;
  const canPass = gameState.phase === 'Playing' && isMyTurn && !isLeading;

  // Player info panel with team level
  const PlayerPanel = ({ player, position }: { player: GuandanPlayerView | null; position: 'top' | 'left' | 'right' | 'bottom' }) => {
    if (!player) return <div />;
    const isCurrent = gameState.players[gameState.currentPlayerIndex]?.name === player.name;
    const isPartner = player.team === myTeam && player.name !== displayName;
    const teamColor = player.team === 'A' ? 'text-blue-400' : 'text-orange-400';
    const teamBg = player.team === 'A' ? 'bg-blue-900/30 border-blue-700/50' : 'bg-orange-900/30 border-orange-700/50';
    const teamLevel = player.team === 'A' ? gameState.teamALevel : gameState.teamBLevel;

    return (
      <div className={`
        rounded-xl p-2 border transition-all min-w-[100px]
        ${isCurrent ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/20' : ''}
        ${player.isFinished ? 'opacity-60' : ''}
        ${teamBg}
      `}>
        <div className="flex items-center gap-1.5 mb-1">
          {player.isBot && <span className="text-[10px]" title="AI Bot">🤖</span>}
          <span className="text-white font-semibold text-xs truncate max-w-[70px]">{player.name}</span>
          {isPartner && <span className="text-[9px] bg-green-800/50 text-green-300 px-1 rounded">Ally</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={`font-bold ${teamColor}`}>
            {player.team === 'A' ? '🔵' : '🟠'} Lv.{levelToString(teamLevel)}
          </span>
          {player.isFinished ? (
            <span className="text-yellow-400 font-bold">#{player.finishOrder}</span>
          ) : (
            <span className="text-gray-400">{player.cardsRemaining}🃏</span>
          )}
        </div>
        {position !== 'bottom' && !player.isFinished && player.cardsRemaining > 0 && (
          <div className="mt-1.5">
            <CardBack count={player.cardsRemaining} small />
          </div>
        )}
      </div>
    );
  };

  // Finish order badge
  const FinishBadge = ({ order }: { order: number }) => {
    const labels = ['', '🏆 1st', '🥈 2nd', '🥉 3rd', '4th'];
    const colors = ['', 'text-yellow-400', 'text-gray-300', 'text-orange-400', 'text-gray-500'];
    return <span className={`text-xs font-bold ${colors[order]}`}>{labels[order]}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="text-gray-500 hover:text-gray-300 transition-colors text-sm"
          >
            ← Back
          </button>
          <span className="text-lg">🥚</span>
          <span className="text-white font-bold text-sm">Guandan 掼蛋</span>
          <span className="text-gray-500 font-mono text-xs">#{code}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 font-medium">🔵 A: Lv.{levelToString(gameState.teamALevel)}</span>
            <span className="text-gray-600">|</span>
            <span className="text-orange-400 font-medium">🟠 B: Lv.{levelToString(gameState.teamBLevel)}</span>
          </div>
          {gameState.roundNumber > 0 && (
            <span className="text-gray-500">R{gameState.roundNumber}</span>
          )}
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="bg-red-900/80 text-red-200 text-center py-1.5 text-sm animate-pulse">
          {actionError}
        </div>
      )}

      {/* Game table — square-ish layout */}
      <div className="flex-1 flex items-center justify-center p-2 relative min-h-0">
        {/* Waiting / Pre-game overlay */}
        {(gameState.phase === 'Waiting' || gameState.phase === 'RoundEnd') && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50">
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 text-center max-w-md">
              {gameState.phase === 'RoundEnd' && (
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-white mb-2">Round {gameState.roundNumber} Complete!</h2>
                  <div className="space-y-1">
                    {gameState.finishOrder.map((name, i) => (
                      <div key={name} className="flex items-center justify-center gap-2">
                        <FinishBadge order={i + 1} />
                        <span className="text-gray-300 text-sm">{name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-sm">
                    <span className="text-blue-400">Team A: Lv.{levelToString(gameState.teamALevel)}</span>
                    <span className="text-gray-600 mx-2">|</span>
                    <span className="text-orange-400">Team B: Lv.{levelToString(gameState.teamBLevel)}</span>
                  </div>
                </div>
              )}
              {gameState.phase === 'Waiting' && (
                <div className="mb-4">
                  <div className="text-4xl mb-2">🥚</div>
                  <h2 className="text-lg font-bold text-white mb-2">
                    {gameState.players.length < 4 ? 'Waiting for Players...' : 'Ready to Play!'}
                  </h2>
                  <p className="text-gray-400 text-sm">
                    {gameState.players.length}/4 players joined
                  </p>
                  <div className="mt-2 space-y-1">
                    {gameState.players.map(p => (
                      <div key={p.name} className="text-sm flex items-center justify-center gap-1">
                        <span className={p.team === 'A' ? 'text-blue-400' : 'text-orange-400'}>
                          Team {p.team}
                        </span>
                        <span className="text-gray-400">—</span>
                        {p.isBot && <span title="AI Bot">🤖</span>}
                        <span className="text-white">{p.name}</span>
                      </div>
                    ))}
                  </div>
                  {gameState.players.length < 4 && (
                    <button
                      onClick={fillBots}
                      className="mt-3 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors text-sm"
                    >
                      🤖 Fill with AI Bots
                    </button>
                  )}
                </div>
              )}
              {gameState.players.length === 4 && (
                <button
                  onClick={startRound}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors"
                >
                  {gameState.phase === 'RoundEnd' ? 'Next Round' : 'Start Game'} 🥚
                </button>
              )}
            </div>
          </div>
        )}

        {/* Game Over overlay */}
        {gameState.phase === 'GameOver' && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/60">
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 text-center max-w-md">
              <div className="text-4xl mb-2">🏆</div>
              <h2 className="text-xl font-bold text-white mb-2">Game Over!</h2>
              <div className="text-lg mb-3">
                {gameState.teamALevel >= 14 ? (
                  <span className="text-blue-400 font-bold">Team A Wins!</span>
                ) : (
                  <span className="text-orange-400 font-bold">Team B Wins!</span>
                )}
              </div>
              <div className="space-y-1 mb-4">
                {gameState.finishOrder.map((name, i) => (
                  <div key={name} className="flex items-center justify-center gap-2">
                    <FinishBadge order={i + 1} />
                    <span className="text-gray-300">{name}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Back to Games
              </button>
            </div>
          </div>
        )}

        {/* Square table layout */}
        <div className="w-full max-w-3xl mx-auto" style={{ aspectRatio: '4 / 3' }}>
          <div className="w-full h-full grid grid-rows-[auto_1fr_auto] gap-1">
            {/* Top row: top player + their played cards */}
            <div className="flex flex-col items-center gap-1">
              <PlayerPanel player={positions.top} position="top" />
              {positions.top?.lastPlayCards && positions.top.lastPlayCards.length > 0 && (
                <MiniCards cards={positions.top.lastPlayCards} levelRank={myLevelRank} />
              )}
            </div>

            {/* Middle row: left + center + right */}
            <div className="grid grid-cols-[auto_1fr_auto] gap-1 items-center min-h-0">
              {/* Left player + their played cards */}
              <div className="flex items-center gap-1">
                <PlayerPanel player={positions.left} position="left" />
                {positions.left?.lastPlayCards && positions.left.lastPlayCards.length > 0 && (
                  <div className="max-w-[120px]">
                    <MiniCards cards={positions.left.lastPlayCards} levelRank={myLevelRank} />
                  </div>
                )}
              </div>

              {/* Center play area */}
              <div className="flex flex-col items-center justify-center bg-green-900/20 rounded-2xl border border-green-800/20 min-h-[140px] p-3 relative">
                {/* Turn indicator */}
                {gameState.phase === 'Playing' && (
                  <div className="absolute top-1.5 left-0 right-0 text-center">
                    {aiThinking ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-600/30 text-purple-300 animate-pulse">
                        🤖 {aiThinking} thinking...
                      </span>
                    ) : (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isMyTurn ? 'bg-yellow-600/30 text-yellow-300' : 'bg-gray-700/50 text-gray-400'}`}>
                        {isMyTurn ? "Your turn!" : `${currentPlayerName}'s turn`}
                      </span>
                    )}
                  </div>
                )}

                {/* Current play in center */}
                {gameState.currentPlay.length > 0 ? (
                  <div className="flex flex-col items-center gap-1.5 mt-3">
                    <div className="flex -space-x-2 flex-wrap justify-center">
                      {gameState.currentPlay.map((card, i) => (
                        <GDCard
                          key={cardKey(card, i)}
                          card={card}
                          levelRank={myLevelRank}
                          small
                        />
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {gameState.currentPlayType}
                      {gameState.lastPlayerIndex >= 0 && (
                        <span> · <span className="text-white">{gameState.players[gameState.lastPlayerIndex]?.name}</span></span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-600 text-xs mt-3">
                    {gameState.phase === 'Playing' ? (isMyTurn ? 'Lead any combination' : 'Waiting...') : ''}
                  </div>
                )}

                {/* Pass indicators */}
                {gameState.consecutivePasses > 0 && (
                  <div className="absolute bottom-1.5 text-[10px] text-gray-500">
                    {gameState.consecutivePasses} pass{gameState.consecutivePasses > 1 ? 'es' : ''}
                  </div>
                )}
              </div>

              {/* Right player + their played cards */}
              <div className="flex items-center gap-1">
                {positions.right?.lastPlayCards && positions.right.lastPlayCards.length > 0 && (
                  <div className="max-w-[120px]">
                    <MiniCards cards={positions.right.lastPlayCards} levelRank={myLevelRank} />
                  </div>
                )}
                <PlayerPanel player={positions.right} position="right" />
              </div>
            </div>

            {/* Bottom: my player area */}
            <div className="flex flex-col items-center gap-1.5">
              {/* My played cards (if any) */}
              {positions.bottom?.lastPlayCards && positions.bottom.lastPlayCards.length > 0 && (
                <MiniCards cards={positions.bottom.lastPlayCards} levelRank={myLevelRank} />
              )}

              {/* Player info + action buttons */}
              <div className="flex items-center gap-3">
                <PlayerPanel player={positions.bottom} position="bottom" />
                {/* Action buttons */}
                {gameState.phase === 'Playing' && isMyTurn && (
                  <div className="flex gap-2">
                    {canPlay && (
                      <button
                        onClick={playCards}
                        className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors text-sm"
                      >
                        Play ({selectedCards.length})
                      </button>
                    )}
                    {canPass && (
                      <button
                        onClick={pass}
                        className="px-5 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors text-sm"
                      >
                        Pass
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* My hand */}
              {myPlayer?.hand && myPlayer.hand.length > 0 && (
                <div className="flex -space-x-1 sm:space-x-0 flex-wrap justify-center max-w-full overflow-x-auto pb-1 px-1">
                  {sortedHand.map(({ card, origIdx }) => (
                    <GDCard
                      key={cardKey(card, origIdx)}
                      card={card}
                      selected={selectedCards.includes(origIdx)}
                      onClick={() => toggleCard(origIdx)}
                      levelRank={myLevelRank}
                    />
                  ))}
                </div>
              )}

              {/* Deselect all */}
              {selectedCards.length > 0 && (
                <button
                  onClick={() => setSelectedCards([])}
                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Level progress bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-3 py-1.5">
        <div className="max-w-3xl mx-auto flex items-center gap-3 text-[10px]">
          <div className="flex-1">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-blue-400 font-medium">🔵 Team A</span>
              <span className="text-gray-500">Lv.{levelToString(gameState.teamALevel)}</span>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${((gameState.teamALevel - 2) / 12) * 100}%` }}
              />
            </div>
          </div>
          <div className="text-gray-600 font-mono text-[9px]">
            {['2','3','4','5','6','7','8','9','10','J','Q','K','A'].map(l => (
              <span
                key={l}
                className={`inline-block w-3 text-center ${
                  levelToString(gameState.teamALevel) === l ? 'text-blue-400 font-bold' :
                  levelToString(gameState.teamBLevel) === l ? 'text-orange-400 font-bold' :
                  'text-gray-700'
                }`}
              >
                {l}
              </span>
            ))}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-end gap-1 mb-0.5">
              <span className="text-gray-500">Lv.{levelToString(gameState.teamBLevel)}</span>
              <span className="text-orange-400 font-medium">Team B 🟠</span>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all ml-auto"
                style={{ width: `${((gameState.teamBLevel - 2) / 12) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
