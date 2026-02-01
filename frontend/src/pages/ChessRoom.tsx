import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { startGameConnection, stopGameConnection } from '../services/signalr';
import { sounds } from '../services/sounds';
import VideoChat from '../components/VideoChat';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import type { HubConnection } from '@microsoft/signalr';

// ===== Types =====

interface ChessState {
  id: number;
  roomId: number;
  fen: string;
  board: string[][];
  moveHistory: string[];
  whitePlayer: string | null;
  blackPlayer: string | null;
  status: string; // Waiting, Playing, Check, Checkmate, Stalemate, Draw, WhiteWins, BlackWins
  currentTurn: string; // White, Black
  capturedWhite: string[];
  capturedBlack: string[];
  legalMoves: Record<string, string[]>;
  drawOfferFrom: string | null;
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
  chessState: ChessState | null;
}

interface JoinResponse {
  displayName: string;
  color: string;
  room: RoomData;
}

// ===== Constants =====

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const PIECE_VALUES: Record<string, number> = {
  '♙': 1, '♟': 1, '♘': 3, '♞': 3, '♗': 3, '♝': 3,
  '♖': 5, '♜': 5, '♕': 9, '♛': 9, '♔': 0, '♚': 0,
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

// ===== Helpers =====

function squareNotation(row: number, col: number): string {
  return `${FILES[col]}${RANKS[row]}`;
}

function isLightSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 0;
}

function materialAdvantage(capturedWhite: string[], capturedBlack: string[]): number {
  const whiteCapVal = capturedWhite.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);
  const blackCapVal = capturedBlack.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);
  return blackCapVal - whiteCapVal; // positive = white advantage
}

// ===== Main Component =====

export default function ChessRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [myName, setMyName] = useState('');
  const [myColor, setMyColor] = useState('#3B82F6');
  const [loading, setLoading] = useState(true);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState('');
  const [gameState, setGameState] = useState<ChessState | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [showPromotion, setShowPromotion] = useState<{ from: string; to: string } | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const connRef = useRef<HubConnection | null>(null);

  // Determine my color
  const myChessColor = gameState?.whitePlayer === myName ? 'White' : gameState?.blackPlayer === myName ? 'Black' : null;
  const isMyTurn = myChessColor === gameState?.currentTurn && (gameState?.status === 'Playing' || gameState?.status === 'Check');
  const isFlipped = myChessColor === 'Black';

  // Get legal destinations for selected piece
  const legalDestinations = useMemo(() => {
    if (!selectedSquare || !gameState?.legalMoves) return [];
    return gameState.legalMoves[selectedSquare] || [];
  }, [selectedSquare, gameState?.legalMoves]);

  // Find king square for check highlight
  const kingInCheck = useMemo(() => {
    if (!gameState || (gameState.status !== 'Check' && gameState.status !== 'Checkmate')) return null;
    const kingPiece = gameState.currentTurn === 'White' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (gameState.board[r][c] === kingPiece) return squareNotation(r, c);
      }
    }
    return null;
  }, [gameState]);

  const joinAndLoad = useCallback(
    async (displayName: string) => {
      if (!code) return;
      try {
        const resp = await api.post<JoinResponse>(`/rooms/${code}/join`, { displayName });
        setMyName(resp.displayName);
        setMyColor(resp.color);
        setRoom(resp.room);
        if (resp.room.chessState) {
          setGameState(resp.room.chessState);
        }
        localStorage.setItem('sudoku_name', displayName);

        const conn = await startGameConnection();
        connRef.current = conn;
        await conn.invoke('JoinRoom', code, displayName);

        conn.on('ChessStateUpdated', (stateJson: string) => {
          const state: ChessState = JSON.parse(stateJson);
          setGameState((prev) => {
            // Track last move from move history diff
            if (prev && state.moveHistory.length > prev.moveHistory.length) {
              // Detect the from/to from the board diff
              const changes: { row: number; col: number; was: string; now: string }[] = [];
              for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                  if (prev.board[r][c] !== state.board[r][c]) {
                    changes.push({ row: r, col: c, was: prev.board[r][c], now: state.board[r][c] });
                  }
                }
              }
              // Find the square that was emptied (from) and the square that got a piece (to)
              const fromChange = changes.find((ch) => ch.now === '' && ch.was !== '');
              const toChange = changes.find((ch) => ch.now !== '' && (ch.was === '' || ch.was !== ch.now));
              if (fromChange && toChange) {
                setLastMove({
                  from: squareNotation(fromChange.row, fromChange.col),
                  to: squareNotation(toChange.row, toChange.col),
                });
              }
              sounds.cardPlace();
            }
            return state;
          });
          setSelectedSquare(null);
        });

        conn.on('ChessError', (msg: string) => {
          setError(msg);
          setTimeout(() => setError(''), 3000);
        });

        conn.on('PlayerJoined', () => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members, playerColors: r.playerColors } : prev);
            if (r.chessState) setGameState(r.chessState);
          });
        });

        conn.on('PlayerLeft', () => {
          api.get<RoomData>(`/rooms/${code}`).then((r) => {
            setRoom((prev) => prev ? { ...prev, members: r.members } : prev);
          });
        });

        conn.on('RoomClosed', (reason: string) => {
          alert(reason || 'This room has been closed.');
          navigate('/games/chess');
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

  const handleSquareClick = useCallback(
    (row: number, col: number) => {
      if (!gameState || !isMyTurn) return;

      const sq = squareNotation(row, col);
      const piece = gameState.board[row][col];

      if (selectedSquare) {
        // Check if clicking on the same square — deselect
        if (selectedSquare === sq) {
          setSelectedSquare(null);
          return;
        }

        // Check if clicking on own piece — reselect
        const isOwnPiece = piece && (
          (myChessColor === 'White' && piece === piece.toUpperCase() && piece !== piece.toLowerCase()) ||
          (myChessColor === 'Black' && piece === piece.toLowerCase() && piece !== piece.toUpperCase())
        );
        if (isOwnPiece && gameState.legalMoves[sq]) {
          setSelectedSquare(sq);
          return;
        }

        // Try to move
        if (legalDestinations.includes(sq)) {
          // Check if this is a pawn promotion
          const selectedPiece = (() => {
            for (let r = 0; r < 8; r++) {
              for (let c = 0; c < 8; c++) {
                if (squareNotation(r, c) === selectedSquare) return gameState.board[r][c];
              }
            }
            return '';
          })();

          const isPawnPromo =
            (selectedPiece === 'P' && row === 0) ||
            (selectedPiece === 'p' && row === 7);

          if (isPawnPromo) {
            setShowPromotion({ from: selectedSquare, to: sq });
            return;
          }

          makeMove(selectedSquare, sq);
        } else {
          setSelectedSquare(null);
        }
      } else {
        // Select a piece if it's ours and has legal moves
        const isOwnPiece = piece && (
          (myChessColor === 'White' && piece === piece.toUpperCase() && piece !== piece.toLowerCase()) ||
          (myChessColor === 'Black' && piece === piece.toLowerCase() && piece !== piece.toUpperCase())
        );
        if (isOwnPiece && gameState.legalMoves[sq]?.length > 0) {
          setSelectedSquare(sq);
        }
      }
    },
    [gameState, selectedSquare, isMyTurn, myChessColor, legalDestinations]
  );

  const makeMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (!connRef.current || !code) return;
      connRef.current.invoke('ChessMakeMove', code, myName, from, to, promotion || null).catch(console.error);
      setSelectedSquare(null);
      setShowPromotion(null);
    },
    [code, myName]
  );

  const handleResign = useCallback(() => {
    if (!connRef.current || !code) return;
    if (!confirm('Are you sure you want to resign?')) return;
    connRef.current.invoke('ChessResign', code, myName).catch(console.error);
  }, [code, myName]);

  const handleOfferDraw = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('ChessOfferDraw', code, myName).catch(console.error);
  }, [code, myName]);

  const handleAcceptDraw = useCallback(() => {
    if (!connRef.current || !code) return;
    connRef.current.invoke('ChessAcceptDraw', code, myName).catch(console.error);
  }, [code, myName]);

  const handleCloseRoom = useCallback(() => {
    if (!connRef.current || !code || !room) return;
    if (!confirm('Close this room? All players will be disconnected.')) return;
    connRef.current.invoke('CloseRoom', code, myName).catch(() => {});
  }, [code, room, myName]);

  // ===== Render =====

  if (needsName) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">♟️</div>
            <h1 className="text-3xl font-bold text-white">Join Chess Game</h1>
            <p className="text-gray-400 mt-2">Room: <span className="font-mono text-slate-400 font-bold">{code}</span></p>
          </div>
          <form onSubmit={handleNameSubmit} className="bg-gray-800 rounded-2xl p-8 border border-gray-700 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Your Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                autoFocus
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <button type="submit" className="w-full py-3 bg-slate-600 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors">
              Join Game
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
          <div className="w-12 h-12 border-4 border-slate-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Setting up the board...</p>
        </div>
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button onClick={() => navigate('/games/chess')} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!room) return null;

  const isHost = room.hostName === myName;
  const board = gameState?.board || Array(8).fill(null).map(() => Array(8).fill(''));
  const status = gameState?.status || 'Waiting';
  const isGameOver = ['Checkmate', 'Stalemate', 'Draw', 'WhiteWins', 'BlackWins'].includes(status);
  const matAdv = gameState ? materialAdvantage(gameState.capturedWhite, gameState.capturedBlack) : 0;

  // Build the visual row/col indices (flipped for black)
  const rowIndices = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const colIndices = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="min-h-screen bg-[#0a1a0a] transition-colors duration-500">
      {/* Header */}
      <header className="border-b border-gray-800/50 px-2 sm:px-4 py-2 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <button onClick={() => navigate('/games/chess')} className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm flex-shrink-0">
            ← Back
          </button>
          <h1 className="text-white font-bold text-sm sm:text-lg truncate">
            <span className="text-slate-300">♟</span>{' '}
            <span className="text-slate-400">Chess</span>
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <VideoChat connection={connRef.current} roomCode={code || ''} myName={myName} myColor={myColor} />
            <span className="text-gray-500 text-xs sm:text-sm items-center gap-1.5 hidden sm:flex">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: myColor }} />
              {myName}
              {myChessColor && <span className="text-gray-600 ml-1">({myChessColor})</span>}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3 sm:py-6">
        {/* Error banner */}
        {error && (
          <div className="max-w-2xl mx-auto mb-4 bg-red-900/50 border border-red-500 text-red-300 px-4 py-2 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {/* Status banner */}
        {status === 'Waiting' && (
          <div className="max-w-2xl mx-auto mb-4 bg-yellow-900/40 border border-yellow-600/50 text-yellow-300 px-4 py-3 rounded-lg text-center">
            ⏳ Waiting for opponent to join...
          </div>
        )}
        {status === 'Check' && (
          <div className="max-w-2xl mx-auto mb-4 bg-red-900/40 border border-red-600/50 text-red-300 px-4 py-2 rounded-lg text-center font-bold animate-pulse">
            ⚠️ Check!
          </div>
        )}
        {status === 'Checkmate' && (
          <div className="max-w-2xl mx-auto mb-4 bg-amber-900/50 border border-amber-500 text-amber-300 px-4 py-3 rounded-lg text-center">
            <div className="text-2xl font-bold">♚ Checkmate!</div>
            <div className="text-sm mt-1">
              {gameState?.currentTurn === 'White' ? gameState?.blackPlayer : gameState?.whitePlayer} wins!
            </div>
          </div>
        )}
        {status === 'Stalemate' && (
          <div className="max-w-2xl mx-auto mb-4 bg-blue-900/50 border border-blue-500 text-blue-300 px-4 py-3 rounded-lg text-center">
            <div className="text-2xl font-bold">🤝 Stalemate!</div>
            <div className="text-sm mt-1">The game is a draw.</div>
          </div>
        )}
        {status === 'Draw' && (
          <div className="max-w-2xl mx-auto mb-4 bg-blue-900/50 border border-blue-500 text-blue-300 px-4 py-3 rounded-lg text-center">
            <div className="text-2xl font-bold">🤝 Draw!</div>
            <div className="text-sm mt-1">Both players agreed to a draw.</div>
          </div>
        )}
        {(status === 'WhiteWins' || status === 'BlackWins') && (
          <div className="max-w-2xl mx-auto mb-4 bg-amber-900/50 border border-amber-500 text-amber-300 px-4 py-3 rounded-lg text-center">
            <div className="text-2xl font-bold">🏳️ Resignation</div>
            <div className="text-sm mt-1">
              {status === 'WhiteWins' ? gameState?.whitePlayer : gameState?.blackPlayer} wins by resignation!
            </div>
          </div>
        )}

        {/* Draw offer banner */}
        {gameState?.drawOfferFrom && gameState.drawOfferFrom !== myName && !isGameOver && (
          <div className="max-w-2xl mx-auto mb-4 bg-blue-900/40 border border-blue-500/50 text-blue-300 px-4 py-3 rounded-lg text-center flex items-center justify-center gap-3 flex-wrap">
            <span>🤝 <strong>{gameState.drawOfferFrom}</strong> offers a draw</span>
            <button
              onClick={handleAcceptDraw}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Accept
            </button>
            <span className="text-blue-500 text-sm">(or just make a move to decline)</span>
          </div>
        )}
        {gameState?.drawOfferFrom === myName && !isGameOver && (
          <div className="max-w-2xl mx-auto mb-4 bg-blue-900/30 border border-blue-600/30 text-blue-400 px-4 py-2 rounded-lg text-center text-sm">
            ⏳ Draw offer sent. Waiting for opponent...
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-3 sm:gap-6 items-start justify-center">
          {/* Main board area */}
          <div className="flex-1 max-w-[560px] mx-auto w-full">
            {/* Opponent info bar */}
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${isFlipped ? 'bg-white' : 'bg-gray-800 border border-gray-500'}`} />
                <span className="text-white font-medium text-sm">
                  {isFlipped ? (gameState?.whitePlayer || 'Waiting...') : (gameState?.blackPlayer || 'Waiting...')}
                </span>
                <span className="text-gray-500 text-xs">
                  ({isFlipped ? 'White' : 'Black'})
                </span>
              </div>
              {/* Captured pieces (opponent's captures) */}
              <div className="flex gap-0.5 text-lg">
                {(isFlipped ? gameState?.capturedBlack : gameState?.capturedWhite)?.map((p, i) => (
                  <span key={i} className="opacity-70">{p}</span>
                ))}
                {!isFlipped && matAdv < 0 && <span className="text-gray-500 text-xs ml-1">+{Math.abs(matAdv)}</span>}
                {isFlipped && matAdv > 0 && <span className="text-gray-500 text-xs ml-1">+{matAdv}</span>}
              </div>
            </div>

            {/* Chess Board */}
            <div
              className="relative rounded-lg overflow-hidden border-2 border-amber-900/60 shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
              style={{
                background: '#302e2b',
              }}
            >
              <div className="grid grid-cols-8 aspect-square">
                {rowIndices.map((r) =>
                  colIndices.map((c) => {
                    const sq = squareNotation(r, c);
                    const piece = board[r][c];
                    const unicode = piece ? PIECE_UNICODE[piece] : '';
                    const isLight = isLightSquare(r, c);
                    const isSelected = selectedSquare === sq;
                    const isLegalDest = legalDestinations.includes(sq);
                    const isLastMoveFrom = lastMove?.from === sq;
                    const isLastMoveTo = lastMove?.to === sq;
                    const isKingCheck = kingInCheck === sq;
                    const isCaptureDest = isLegalDest && piece !== '';

                    // Determine if it's a clickable own piece
                    const isClickable = isMyTurn && (
                      (myChessColor === 'White' && piece && piece === piece.toUpperCase() && piece !== piece.toLowerCase()) ||
                      (myChessColor === 'Black' && piece && piece === piece.toLowerCase() && piece !== piece.toUpperCase())
                    );

                    let bgColor = isLight ? 'bg-[#ebecd0]' : 'bg-[#779556]';
                    if (isSelected) bgColor = isLight ? 'bg-[#f6f682]' : 'bg-[#bbcc44]';
                    else if (isLastMoveFrom || isLastMoveTo) bgColor = isLight ? 'bg-[#f6f682]/60' : 'bg-[#bbcc44]/60';
                    if (isKingCheck) bgColor = 'bg-red-500/80';

                    return (
                      <div
                        key={sq}
                        className={`relative ${bgColor} flex items-center justify-center transition-colors duration-100
                          ${(isClickable || isLegalDest || isSelected) ? 'cursor-pointer' : ''}
                        `}
                        onClick={() => handleSquareClick(r, c)}
                      >
                        {/* Legal move indicator */}
                        {isLegalDest && !isCaptureDest && (
                          <div className="absolute w-[28%] h-[28%] rounded-full bg-black/20 z-10" />
                        )}
                        {isLegalDest && isCaptureDest && (
                          <div className="absolute inset-0 border-[4px] sm:border-[5px] border-black/20 rounded-full z-10" />
                        )}

                        {/* Piece */}
                        {unicode && (
                          <span
                            className={`text-[min(8vw,56px)] sm:text-[56px] leading-none select-none z-20 drop-shadow-sm
                              ${piece === piece.toUpperCase() && piece !== piece.toLowerCase() ? 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]' : 'text-gray-900 [text-shadow:0_1px_2px_rgba(255,255,255,0.2)]'}
                            `}
                          >
                            {unicode}
                          </span>
                        )}

                        {/* Rank labels (left edge) */}
                        {(isFlipped ? c === 7 : c === 0) && (
                          <span className={`absolute top-0.5 left-1 text-[9px] sm:text-[10px] font-bold ${isLight ? 'text-[#779556]' : 'text-[#ebecd0]'} select-none`}>
                            {8 - r}
                          </span>
                        )}
                        {/* File labels (bottom edge) */}
                        {(isFlipped ? r === 0 : r === 7) && (
                          <span className={`absolute bottom-0 right-1 text-[9px] sm:text-[10px] font-bold ${isLight ? 'text-[#779556]' : 'text-[#ebecd0]'} select-none`}>
                            {FILES[c]}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Player info bar */}
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${isFlipped ? 'bg-gray-800 border border-gray-500' : 'bg-white'}`} />
                <span className="text-white font-medium text-sm">
                  {isFlipped ? (gameState?.blackPlayer || 'Waiting...') : (gameState?.whitePlayer || 'Waiting...')}
                </span>
                <span className="text-gray-500 text-xs">
                  ({isFlipped ? 'Black' : 'White'})
                </span>
                {isMyTurn && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 animate-pulse">
                    Your turn
                  </span>
                )}
              </div>
              <div className="flex gap-0.5 text-lg">
                {(isFlipped ? gameState?.capturedWhite : gameState?.capturedBlack)?.map((p, i) => (
                  <span key={i} className="opacity-70">{p}</span>
                ))}
                {isFlipped && matAdv < 0 && <span className="text-gray-500 text-xs ml-1">+{Math.abs(matAdv)}</span>}
                {!isFlipped && matAdv > 0 && <span className="text-gray-500 text-xs ml-1">+{matAdv}</span>}
              </div>
            </div>

            {/* Action buttons */}
            {myChessColor && !isGameOver && gameState?.status !== 'Waiting' && (
              <div className="flex justify-center gap-3 mt-4">
                <button
                  onClick={handleOfferDraw}
                  disabled={!!gameState?.drawOfferFrom}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  🤝 Offer Draw
                </button>
                <button
                  onClick={handleResign}
                  className="px-4 py-2 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-700/50"
                >
                  🏳️ Resign
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-64 flex-shrink-0 space-y-3">
            <CollapsibleSidebar title={`Players (${room.members.length})`} badge={room.code}>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-4">
                <div>
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-1">Room Code</h3>
                  <div className="font-mono text-2xl font-bold text-white tracking-widest text-center py-1">{room.code}</div>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`)}
                    className="mt-2 w-full py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    📋 Copy Invite Link
                  </button>
                </div>

                {/* Turn indicator */}
                {gameState && !isGameOver && gameState.status !== 'Waiting' && (
                  <div className="text-center py-2">
                    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                      gameState.currentTurn === 'White'
                        ? 'bg-white/10 text-white'
                        : 'bg-gray-900 text-gray-300 border border-gray-700'
                    }`}>
                      <span className={`w-3 h-3 rounded-full ${gameState.currentTurn === 'White' ? 'bg-white' : 'bg-gray-800 border border-gray-500'}`} />
                      {gameState.currentTurn}'s turn
                    </span>
                  </div>
                )}

                {/* Players */}
                <div>
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Players</h3>
                  <div className="space-y-1.5">
                    {gameState?.whitePlayer && (
                      <div className={`flex items-center gap-2 p-2 rounded-lg ${
                        gameState.currentTurn === 'White' && !isGameOver ? 'bg-white/10 ring-1 ring-white/20' : 'bg-gray-700/50'
                      }`}>
                        <span className="w-4 h-4 rounded-full bg-white border border-gray-300 flex-shrink-0" />
                        <span className="text-white text-sm truncate">
                          {gameState.whitePlayer}
                          {gameState.whitePlayer === myName && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                        </span>
                        <span className="text-gray-500 text-xs ml-auto">White</span>
                      </div>
                    )}
                    {gameState?.blackPlayer ? (
                      <div className={`flex items-center gap-2 p-2 rounded-lg ${
                        gameState.currentTurn === 'Black' && !isGameOver ? 'bg-gray-600/40 ring-1 ring-gray-500/30' : 'bg-gray-700/50'
                      }`}>
                        <span className="w-4 h-4 rounded-full bg-gray-800 border border-gray-500 flex-shrink-0" />
                        <span className="text-white text-sm truncate">
                          {gameState.blackPlayer}
                          {gameState.blackPlayer === myName && <span className="text-gray-400 text-xs ml-1">(you)</span>}
                        </span>
                        <span className="text-gray-500 text-xs ml-auto">Black</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/30 border border-dashed border-gray-600">
                        <span className="w-4 h-4 rounded-full bg-gray-800 border border-gray-600 flex-shrink-0" />
                        <span className="text-gray-500 text-sm italic">Waiting for opponent...</span>
                      </div>
                    )}
                    {/* Spectators */}
                    {room.members
                      .filter((m) => m.displayName !== gameState?.whitePlayer && m.displayName !== gameState?.blackPlayer)
                      .map((m) => (
                        <div key={m.displayName} className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/30">
                          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                          <span className="text-gray-400 text-sm truncate">
                            {m.displayName}
                            {m.displayName === myName && <span className="text-gray-500 text-xs ml-1">(you)</span>}
                          </span>
                          <span className="text-gray-600 text-xs ml-auto">👀</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Move History */}
                {gameState && gameState.moveHistory.length > 0 && (
                  <div>
                    <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">📜 Moves</h3>
                    <div className="max-h-48 overflow-y-auto bg-gray-900/50 rounded-lg p-2 text-xs font-mono space-y-0.5">
                      {Array.from({ length: Math.ceil(gameState.moveHistory.length / 2) }).map((_, i) => {
                        const whiteMove = gameState.moveHistory[i * 2];
                        const blackMove = gameState.moveHistory[i * 2 + 1];
                        return (
                          <div key={i} className="flex gap-1">
                            <span className="text-gray-600 w-6 text-right">{i + 1}.</span>
                            <span className="text-white w-14">{whiteMove}</span>
                            {blackMove && <span className="text-gray-300 w-14">{blackMove}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-gray-700">
                  <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">How to Play</h3>
                  <div className="text-gray-500 text-xs space-y-1">
                    <p>1. Click a piece to select it</p>
                    <p>2. Click a highlighted square to move</p>
                    <p>3. First to join plays <span className="text-white font-bold">White</span></p>
                    <p>4. Checkmate your opponent to win!</p>
                  </div>
                </div>

                {isHost && (
                  <button
                    onClick={handleCloseRoom}
                    className="w-full py-2 bg-red-900/50 hover:bg-red-800 text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-700/50"
                  >
                    🚪 Close Room
                  </button>
                )}
              </div>
            </CollapsibleSidebar>
          </div>
        </div>
      </div>

      {/* Promotion Modal */}
      {showPromotion && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPromotion(null)}>
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-600 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-4 text-center">Promote Pawn</h3>
            <div className="flex gap-3">
              {[
                { piece: 'q', label: 'Queen', unicode: myChessColor === 'White' ? '♕' : '♛' },
                { piece: 'r', label: 'Rook', unicode: myChessColor === 'White' ? '♖' : '♜' },
                { piece: 'b', label: 'Bishop', unicode: myChessColor === 'White' ? '♗' : '♝' },
                { piece: 'n', label: 'Knight', unicode: myChessColor === 'White' ? '♘' : '♞' },
              ].map(({ piece, label, unicode }) => (
                <button
                  key={piece}
                  onClick={() => makeMove(showPromotion.from, showPromotion.to, piece)}
                  className="w-16 h-16 rounded-xl bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-4xl transition-all hover:scale-110 active:scale-95"
                  title={label}
                >
                  {unicode}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
