using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class ChessService
{
    private readonly string _connectionString;
    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public ChessService(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
    }

    private SqlConnection GetConnection() => new(_connectionString);

    // ==================== Database Operations ====================

    public async Task<ChessGameState> InitializeGame(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = new ChessGameState
        {
            RoomId = roomId,
            Fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            MoveHistoryJson = "[]",
            WhitePlayer = null,
            BlackPlayer = null,
            Status = "Waiting",
            CurrentTurn = "White",
            CapturedJson = "{\"white\":[],\"black\":[]}",
            DrawOfferFrom = null
        };

        state.Id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO ChessGameStates (RoomId, Fen, MoveHistoryJson, WhitePlayer, BlackPlayer, Status, CurrentTurn, CapturedJson, DrawOfferFrom)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @Fen, @MoveHistoryJson, @WhitePlayer, @BlackPlayer, @Status, @CurrentTurn, @CapturedJson, @DrawOfferFrom)",
            state);

        return state;
    }

    public async Task<ChessGameState?> GetGameState(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<ChessGameState>(
            "SELECT TOP 1 * FROM ChessGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });
    }

    private async Task SaveState(ChessGameState state)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE ChessGameStates
            SET Fen = @Fen, MoveHistoryJson = @MoveHistoryJson, WhitePlayer = @WhitePlayer, BlackPlayer = @BlackPlayer,
                Status = @Status, CurrentTurn = @CurrentTurn, CapturedJson = @CapturedJson, DrawOfferFrom = @DrawOfferFrom
            WHERE Id = @Id", state);
    }

    public async Task<ChessGameState> AssignPlayer(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) state = await InitializeGame(roomId);

        if (state.WhitePlayer == playerName || state.BlackPlayer == playerName)
            return state; // Already assigned

        if (state.WhitePlayer == null)
        {
            state.WhitePlayer = playerName;
            if (state.Status == "Waiting") state.Status = "Waiting";
        }
        else if (state.BlackPlayer == null)
        {
            state.BlackPlayer = playerName;
            state.Status = "Playing";
        }
        // If both slots full, player is a spectator (no assignment)

        await SaveState(state);
        return state;
    }

    // ==================== Move Execution ====================

    public async Task<(ChessGameState state, string? error)> MakeMove(int roomId, string playerName, string from, string to, string? promotion)
    {
        var state = await GetGameState(roomId);
        if (state == null) return (null!, "No game state found");
        if (state.Status != "Playing" && state.Status != "Check")
            return (state, "Game is not in progress");

        // Verify it's this player's turn
        bool isWhite = state.CurrentTurn == "White";
        if (isWhite && state.WhitePlayer != playerName)
            return (state, "It's White's turn");
        if (!isWhite && state.BlackPlayer != playerName)
            return (state, "It's Black's turn");

        var board = FenToBoard(state.Fen);
        var fenParts = state.Fen.Split(' ');
        var castling = fenParts.Length > 2 ? fenParts[2] : "-";
        var enPassant = fenParts.Length > 3 ? fenParts[3] : "-";
        int halfmove = fenParts.Length > 4 ? int.Parse(fenParts[4]) : 0;
        int fullmove = fenParts.Length > 5 ? int.Parse(fenParts[5]) : 1;

        var (fromRow, fromCol) = ParseSquare(from);
        var (toRow, toCol) = ParseSquare(to);

        if (fromRow < 0 || toRow < 0)
            return (state, "Invalid square notation");

        var piece = board[fromRow, fromCol];
        if (piece == '\0' || piece == ' ')
            return (state, "No piece at source square");

        // Verify piece belongs to current player
        if (isWhite && !char.IsUpper(piece))
            return (state, "That's not your piece");
        if (!isWhite && !char.IsLower(piece))
            return (state, "That's not your piece");

        // Generate legal moves and check if the requested move is among them
        var legalMoves = GetLegalMoves(board, isWhite, castling, enPassant);
        var requestedMove = legalMoves.FirstOrDefault(m =>
            m.FromRow == fromRow && m.FromCol == fromCol &&
            m.ToRow == toRow && m.ToCol == toCol);

        if (requestedMove == null)
            return (state, "Illegal move");

        // Handle promotion
        if (requestedMove.IsPromotion)
        {
            char promoPiece = (promotion?.ToLower()) switch
            {
                "r" => isWhite ? 'R' : 'r',
                "b" => isWhite ? 'B' : 'b',
                "n" => isWhite ? 'N' : 'n',
                _ => isWhite ? 'Q' : 'q' // Default to queen
            };
            requestedMove.PromotionPiece = promoPiece;
        }

        // Track captured piece
        var captured = board[toRow, toCol];
        bool isEnPassantCapture = requestedMove.IsEnPassant;
        if (isEnPassantCapture)
        {
            captured = isWhite ? 'p' : 'P';
        }

        // Generate algebraic notation BEFORE applying the move
        string algebraic = GenerateAlgebraic(board, requestedMove, legalMoves, isWhite);

        // Apply the move
        ApplyMove(board, requestedMove);

        // Update castling rights
        castling = UpdateCastlingRights(castling, piece, fromRow, fromCol, toRow, toCol);

        // Update en passant
        enPassant = "-";
        if (char.ToLower(piece) == 'p' && Math.Abs(toRow - fromRow) == 2)
        {
            int epRow = (fromRow + toRow) / 2;
            enPassant = SquareToAlgebraic(epRow, fromCol);
        }

        // Update halfmove clock
        if (char.ToLower(piece) == 'p' || captured != '\0' && captured != ' ')
            halfmove = 0;
        else
            halfmove++;

        if (!isWhite) fullmove++;

        // Switch turns
        bool nextIsWhite = !isWhite;
        string nextTurn = nextIsWhite ? "White" : "Black";

        // Check game status
        string newCastling = castling;
        string newEnPassant = enPassant;
        var opponentLegalMoves = GetLegalMoves(board, nextIsWhite, newCastling, newEnPassant);
        bool inCheck = IsKingInCheck(board, nextIsWhite);

        string status;
        if (inCheck && opponentLegalMoves.Count == 0)
        {
            status = "Checkmate";
            algebraic += "#";
        }
        else if (!inCheck && opponentLegalMoves.Count == 0)
        {
            status = "Stalemate";
        }
        else if (inCheck)
        {
            status = "Check";
            algebraic += "+";
        }
        else if (IsInsufficientMaterial(board))
        {
            status = "Draw";
        }
        else if (halfmove >= 100) // 50-move rule
        {
            status = "Draw";
        }
        else
        {
            status = "Playing";
        }

        // Update captured pieces
        var capturedDict = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(state.CapturedJson, _jsonOpts)
            ?? new() { ["white"] = new(), ["black"] = new() };
        if (captured != '\0' && captured != ' ')
        {
            string pieceStr = PieceToUnicode(captured);
            if (char.IsUpper(captured))
                capturedDict["white"].Add(pieceStr); // White piece captured by black
            else
                capturedDict["black"].Add(pieceStr); // Black piece captured by white
        }

        // Build new FEN
        string newFen = BoardToFen(board, nextIsWhite, newCastling, newEnPassant, halfmove, fullmove);

        // Update move history
        var moveHistory = JsonSerializer.Deserialize<List<string>>(state.MoveHistoryJson, _jsonOpts) ?? new();
        moveHistory.Add(algebraic);

        // Clear draw offer on any move
        state.DrawOfferFrom = null;

        state.Fen = newFen;
        state.MoveHistoryJson = JsonSerializer.Serialize(moveHistory, _jsonOpts);
        state.CurrentTurn = nextTurn;
        state.Status = status;
        state.CapturedJson = JsonSerializer.Serialize(capturedDict, _jsonOpts);

        await SaveState(state);
        return (state, null);
    }

    public async Task<ChessGameState> Resign(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) throw new InvalidOperationException("No game state");

        if (state.Status != "Playing" && state.Status != "Check")
            throw new InvalidOperationException("Game is not in progress");

        if (playerName != state.WhitePlayer && playerName != state.BlackPlayer)
            throw new InvalidOperationException("You are not a player in this game");

        state.Status = playerName == state.WhitePlayer ? "BlackWins" : "WhiteWins";
        await SaveState(state);
        return state;
    }

    public async Task<ChessGameState> OfferDraw(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) throw new InvalidOperationException("No game state");

        if (state.Status != "Playing" && state.Status != "Check")
            throw new InvalidOperationException("Game is not in progress");

        if (playerName != state.WhitePlayer && playerName != state.BlackPlayer)
            throw new InvalidOperationException("You are not a player in this game");

        state.DrawOfferFrom = playerName;
        await SaveState(state);
        return state;
    }

    public async Task<ChessGameState> AcceptDraw(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) throw new InvalidOperationException("No game state");

        if (state.DrawOfferFrom == null)
            throw new InvalidOperationException("No draw offer to accept");

        if (state.DrawOfferFrom == playerName)
            throw new InvalidOperationException("You can't accept your own draw offer");

        if (playerName != state.WhitePlayer && playerName != state.BlackPlayer)
            throw new InvalidOperationException("You are not a player in this game");

        state.Status = "Draw";
        state.DrawOfferFrom = null;
        await SaveState(state);
        return state;
    }

    public ChessStateResponse ToResponse(ChessGameState state)
    {
        var moveHistory = JsonSerializer.Deserialize<List<string>>(state.MoveHistoryJson, _jsonOpts) ?? new();
        var captured = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(state.CapturedJson, _jsonOpts)
            ?? new() { ["white"] = new(), ["black"] = new() };

        // Generate board array from FEN for the frontend
        var board = FenToBoard(state.Fen);
        var boardArray = new string[8][];
        for (int r = 0; r < 8; r++)
        {
            boardArray[r] = new string[8];
            for (int c = 0; c < 8; c++)
            {
                var p = board[r, c];
                boardArray[r][c] = (p == '\0' || p == ' ') ? "" : p.ToString();
            }
        }

        // Get legal moves for current player
        var fenParts = state.Fen.Split(' ');
        bool isWhite = state.CurrentTurn == "White";
        var castling = fenParts.Length > 2 ? fenParts[2] : "-";
        var enPassant = fenParts.Length > 3 ? fenParts[3] : "-";
        var legalMoves = (state.Status == "Playing" || state.Status == "Check")
            ? GetLegalMoves(board, isWhite, castling, enPassant)
            : new List<ChessMove>();

        var legalMovesDict = new Dictionary<string, List<string>>();
        foreach (var move in legalMoves)
        {
            var fromSq = SquareToAlgebraic(move.FromRow, move.FromCol);
            var toSq = SquareToAlgebraic(move.ToRow, move.ToCol);
            if (!legalMovesDict.ContainsKey(fromSq))
                legalMovesDict[fromSq] = new();
            if (!legalMovesDict[fromSq].Contains(toSq))
                legalMovesDict[fromSq].Add(toSq);
        }

        return new ChessStateResponse
        {
            Id = state.Id,
            RoomId = state.RoomId,
            Fen = state.Fen,
            Board = boardArray,
            MoveHistory = moveHistory,
            WhitePlayer = state.WhitePlayer,
            BlackPlayer = state.BlackPlayer,
            Status = state.Status,
            CurrentTurn = state.CurrentTurn,
            CapturedWhite = captured.GetValueOrDefault("white", new()),
            CapturedBlack = captured.GetValueOrDefault("black", new()),
            LegalMoves = legalMovesDict,
            DrawOfferFrom = state.DrawOfferFrom
        };
    }

    public static string SerializeState(ChessGameState state, ChessService service)
    {
        var response = service.ToResponse(state);
        return JsonSerializer.Serialize(response, _jsonOpts);
    }

    // ==================== Chess Engine ====================

    private class ChessMove
    {
        public int FromRow { get; set; }
        public int FromCol { get; set; }
        public int ToRow { get; set; }
        public int ToCol { get; set; }
        public bool IsEnPassant { get; set; }
        public bool IsCastling { get; set; }
        public bool IsPromotion { get; set; }
        public char PromotionPiece { get; set; }
    }

    private static (int row, int col) ParseSquare(string sq)
    {
        if (sq.Length != 2) return (-1, -1);
        int col = sq[0] - 'a';
        int row = 8 - (sq[1] - '0');
        if (col < 0 || col > 7 || row < 0 || row > 7) return (-1, -1);
        return (row, col);
    }

    private static string SquareToAlgebraic(int row, int col)
    {
        return $"{(char)('a' + col)}{8 - row}";
    }

    private static char[,] FenToBoard(string fen)
    {
        var board = new char[8, 8];
        var parts = fen.Split(' ');
        var rows = parts[0].Split('/');
        for (int r = 0; r < 8; r++)
        {
            int c = 0;
            foreach (var ch in rows[r])
            {
                if (char.IsDigit(ch))
                {
                    int empty = ch - '0';
                    for (int i = 0; i < empty && c < 8; i++, c++)
                        board[r, c] = '\0';
                }
                else
                {
                    board[r, c] = ch;
                    c++;
                }
            }
        }
        return board;
    }

    private static string BoardToFen(char[,] board, bool isWhiteTurn, string castling, string enPassant, int halfmove, int fullmove)
    {
        var rows = new string[8];
        for (int r = 0; r < 8; r++)
        {
            var row = "";
            int empty = 0;
            for (int c = 0; c < 8; c++)
            {
                var p = board[r, c];
                if (p == '\0' || p == ' ')
                {
                    empty++;
                }
                else
                {
                    if (empty > 0) { row += empty; empty = 0; }
                    row += p;
                }
            }
            if (empty > 0) row += empty;
            rows[r] = row;
        }
        string turn = isWhiteTurn ? "w" : "b";
        if (string.IsNullOrEmpty(castling)) castling = "-";
        return $"{string.Join("/", rows)} {turn} {castling} {enPassant} {halfmove} {fullmove}";
    }

    private static bool IsWhitePiece(char p) => char.IsUpper(p) && p != '\0';
    private static bool IsBlackPiece(char p) => char.IsLower(p) && p != '\0';
    private static bool IsEmpty(char p) => p == '\0' || p == ' ';
    private static bool IsEnemy(char p, bool isWhite) => isWhite ? IsBlackPiece(p) : IsWhitePiece(p);
    private static bool IsFriendly(char p, bool isWhite) => isWhite ? IsWhitePiece(p) : IsBlackPiece(p);

    private static List<ChessMove> GetPseudoLegalMoves(char[,] board, bool isWhite, string castling, string enPassant)
    {
        var moves = new List<ChessMove>();

        for (int r = 0; r < 8; r++)
        {
            for (int c = 0; c < 8; c++)
            {
                var piece = board[r, c];
                if (IsEmpty(piece)) continue;
                if (isWhite && !IsWhitePiece(piece)) continue;
                if (!isWhite && !IsBlackPiece(piece)) continue;

                switch (char.ToLower(piece))
                {
                    case 'p':
                        AddPawnMoves(moves, board, r, c, isWhite, enPassant);
                        break;
                    case 'n':
                        AddKnightMoves(moves, board, r, c, isWhite);
                        break;
                    case 'b':
                        AddSlidingMoves(moves, board, r, c, isWhite, new[] { (-1, -1), (-1, 1), (1, -1), (1, 1) });
                        break;
                    case 'r':
                        AddSlidingMoves(moves, board, r, c, isWhite, new[] { (-1, 0), (1, 0), (0, -1), (0, 1) });
                        break;
                    case 'q':
                        AddSlidingMoves(moves, board, r, c, isWhite, new[] { (-1, -1), (-1, 1), (1, -1), (1, 1), (-1, 0), (1, 0), (0, -1), (0, 1) });
                        break;
                    case 'k':
                        AddKingMoves(moves, board, r, c, isWhite, castling);
                        break;
                }
            }
        }

        return moves;
    }

    private static void AddPawnMoves(List<ChessMove> moves, char[,] board, int r, int c, bool isWhite, string enPassant)
    {
        int dir = isWhite ? -1 : 1;
        int startRow = isWhite ? 6 : 1;
        int promoRow = isWhite ? 0 : 7;

        // Forward 1
        int nr = r + dir;
        if (nr >= 0 && nr < 8 && IsEmpty(board[nr, c]))
        {
            if (nr == promoRow)
                moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = c, IsPromotion = true });
            else
                moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = c });

            // Forward 2 from starting position
            if (r == startRow)
            {
                int nr2 = r + dir * 2;
                if (IsEmpty(board[nr2, c]))
                    moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr2, ToCol = c });
            }
        }

        // Diagonal captures
        foreach (int dc in new[] { -1, 1 })
        {
            int nc = c + dc;
            if (nc < 0 || nc >= 8 || nr < 0 || nr >= 8) continue;

            if (IsEnemy(board[nr, nc], isWhite))
            {
                if (nr == promoRow)
                    moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc, IsPromotion = true });
                else
                    moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc });
            }

            // En passant
            if (enPassant != "-")
            {
                var (epRow, epCol) = ParseSquare(enPassant);
                if (nr == epRow && nc == epCol)
                    moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc, IsEnPassant = true });
            }
        }
    }

    private static void AddKnightMoves(List<ChessMove> moves, char[,] board, int r, int c, bool isWhite)
    {
        int[][] offsets = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        foreach (var off in offsets)
        {
            int nr = r + off[0], nc = c + off[1];
            if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
            if (IsFriendly(board[nr, nc], isWhite)) continue;
            moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc });
        }
    }

    private static void AddSlidingMoves(List<ChessMove> moves, char[,] board, int r, int c, bool isWhite, (int dr, int dc)[] directions)
    {
        foreach (var (dr, dc) in directions)
        {
            int nr = r + dr, nc = c + dc;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8)
            {
                if (IsFriendly(board[nr, nc], isWhite)) break;
                moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc });
                if (IsEnemy(board[nr, nc], isWhite)) break;
                nr += dr; nc += dc;
            }
        }
    }

    private static void AddKingMoves(List<ChessMove> moves, char[,] board, int r, int c, bool isWhite, string castling)
    {
        // Normal king moves
        for (int dr = -1; dr <= 1; dr++)
        {
            for (int dc = -1; dc <= 1; dc++)
            {
                if (dr == 0 && dc == 0) continue;
                int nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
                if (IsFriendly(board[nr, nc], isWhite)) continue;
                moves.Add(new ChessMove { FromRow = r, FromCol = c, ToRow = nr, ToCol = nc });
            }
        }

        // Castling
        if (isWhite)
        {
            // King-side: K
            if (castling.Contains('K') && r == 7 && c == 4)
            {
                if (IsEmpty(board[7, 5]) && IsEmpty(board[7, 6]) && board[7, 7] == 'R')
                {
                    // Check that king is not in check and doesn't pass through check
                    if (!IsSquareAttacked(board, 7, 4, false) &&
                        !IsSquareAttacked(board, 7, 5, false) &&
                        !IsSquareAttacked(board, 7, 6, false))
                    {
                        moves.Add(new ChessMove { FromRow = 7, FromCol = 4, ToRow = 7, ToCol = 6, IsCastling = true });
                    }
                }
            }
            // Queen-side: Q
            if (castling.Contains('Q') && r == 7 && c == 4)
            {
                if (IsEmpty(board[7, 3]) && IsEmpty(board[7, 2]) && IsEmpty(board[7, 1]) && board[7, 0] == 'R')
                {
                    if (!IsSquareAttacked(board, 7, 4, false) &&
                        !IsSquareAttacked(board, 7, 3, false) &&
                        !IsSquareAttacked(board, 7, 2, false))
                    {
                        moves.Add(new ChessMove { FromRow = 7, FromCol = 4, ToRow = 7, ToCol = 2, IsCastling = true });
                    }
                }
            }
        }
        else
        {
            // King-side: k
            if (castling.Contains('k') && r == 0 && c == 4)
            {
                if (IsEmpty(board[0, 5]) && IsEmpty(board[0, 6]) && board[0, 7] == 'r')
                {
                    if (!IsSquareAttacked(board, 0, 4, true) &&
                        !IsSquareAttacked(board, 0, 5, true) &&
                        !IsSquareAttacked(board, 0, 6, true))
                    {
                        moves.Add(new ChessMove { FromRow = 0, FromCol = 4, ToRow = 0, ToCol = 6, IsCastling = true });
                    }
                }
            }
            // Queen-side: q
            if (castling.Contains('q') && r == 0 && c == 4)
            {
                if (IsEmpty(board[0, 3]) && IsEmpty(board[0, 2]) && IsEmpty(board[0, 1]) && board[0, 0] == 'r')
                {
                    if (!IsSquareAttacked(board, 0, 4, true) &&
                        !IsSquareAttacked(board, 0, 3, true) &&
                        !IsSquareAttacked(board, 0, 2, true))
                    {
                        moves.Add(new ChessMove { FromRow = 0, FromCol = 4, ToRow = 0, ToCol = 2, IsCastling = true });
                    }
                }
            }
        }
    }

    /// <summary>Check if a square is attacked by the opponent.</summary>
    /// <param name="byWhite">true if checking if WHITE attacks this square</param>
    private static bool IsSquareAttacked(char[,] board, int row, int col, bool byWhite)
    {
        // Check pawn attacks
        int pawnDir = byWhite ? 1 : -1; // direction FROM which a pawn would attack
        foreach (int dc in new[] { -1, 1 })
        {
            int pr = row + pawnDir, pc = col + dc;
            if (pr >= 0 && pr < 8 && pc >= 0 && pc < 8)
            {
                var p = board[pr, pc];
                if (byWhite && p == 'P') return true;
                if (!byWhite && p == 'p') return true;
            }
        }

        // Check knight attacks
        int[][] knightOffsets = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        foreach (var off in knightOffsets)
        {
            int nr = row + off[0], nc = col + off[1];
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8)
            {
                var p = board[nr, nc];
                if (byWhite && p == 'N') return true;
                if (!byWhite && p == 'n') return true;
            }
        }

        // Check sliding attacks (bishop/queen diagonals, rook/queen straights)
        (int dr, int dc)[] diagDirs = [(-1, -1), (-1, 1), (1, -1), (1, 1)];
        foreach (var (dr, dc2) in diagDirs)
        {
            int nr = row + dr, nc = col + dc2;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8)
            {
                var p = board[nr, nc];
                if (!IsEmpty(p))
                {
                    if (byWhite && (p == 'B' || p == 'Q')) return true;
                    if (!byWhite && (p == 'b' || p == 'q')) return true;
                    break;
                }
                nr += dr; nc += dc2;
            }
        }

        (int dr, int dc)[] straightDirs = [(-1, 0), (1, 0), (0, -1), (0, 1)];
        foreach (var (dr, dc2) in straightDirs)
        {
            int nr = row + dr, nc = col + dc2;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8)
            {
                var p = board[nr, nc];
                if (!IsEmpty(p))
                {
                    if (byWhite && (p == 'R' || p == 'Q')) return true;
                    if (!byWhite && (p == 'r' || p == 'q')) return true;
                    break;
                }
                nr += dr; nc += dc2;
            }
        }

        // Check king attacks
        for (int dr = -1; dr <= 1; dr++)
        {
            for (int dc2 = -1; dc2 <= 1; dc2++)
            {
                if (dr == 0 && dc2 == 0) continue;
                int nr = row + dr, nc = col + dc2;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8)
                {
                    var p = board[nr, nc];
                    if (byWhite && p == 'K') return true;
                    if (!byWhite && p == 'k') return true;
                }
            }
        }

        return false;
    }

    private static bool IsKingInCheck(char[,] board, bool isWhiteKing)
    {
        // Find the king
        for (int r = 0; r < 8; r++)
        {
            for (int c = 0; c < 8; c++)
            {
                if (isWhiteKing && board[r, c] == 'K')
                    return IsSquareAttacked(board, r, c, false); // attacked by black
                if (!isWhiteKing && board[r, c] == 'k')
                    return IsSquareAttacked(board, r, c, true); // attacked by white
            }
        }
        return false;
    }

    private static void ApplyMove(char[,] board, ChessMove move)
    {
        var piece = board[move.FromRow, move.FromCol];

        // En passant capture
        if (move.IsEnPassant)
        {
            // Remove the captured pawn
            int capturedRow = move.FromRow; // pawn is on same row as moving pawn
            board[capturedRow, move.ToCol] = '\0';
        }

        // Castling — move the rook
        if (move.IsCastling)
        {
            if (move.ToCol == 6) // King-side
            {
                board[move.ToRow, 5] = board[move.ToRow, 7];
                board[move.ToRow, 7] = '\0';
            }
            else if (move.ToCol == 2) // Queen-side
            {
                board[move.ToRow, 3] = board[move.ToRow, 0];
                board[move.ToRow, 0] = '\0';
            }
        }

        // Move the piece
        board[move.ToRow, move.ToCol] = move.IsPromotion ? move.PromotionPiece : piece;
        board[move.FromRow, move.FromCol] = '\0';
    }

    private static List<ChessMove> GetLegalMoves(char[,] board, bool isWhite, string castling, string enPassant)
    {
        var pseudoLegal = GetPseudoLegalMoves(board, isWhite, castling, enPassant);
        var legal = new List<ChessMove>();

        foreach (var move in pseudoLegal)
        {
            // Make the move on a copy
            var boardCopy = (char[,])board.Clone();
            ApplyMove(boardCopy, move);

            // Check if our king is in check after the move
            if (!IsKingInCheck(boardCopy, isWhite))
            {
                legal.Add(move);
            }
        }

        return legal;
    }

    private static string UpdateCastlingRights(string castling, char piece, int fromRow, int fromCol, int toRow, int toCol)
    {
        if (castling == "-") return "-";

        var rights = new string(castling.ToCharArray());

        // King moved
        if (piece == 'K') rights = rights.Replace("K", "").Replace("Q", "");
        if (piece == 'k') rights = rights.Replace("k", "").Replace("q", "");

        // Rook moved or captured
        if (fromRow == 7 && fromCol == 0) rights = rights.Replace("Q", "");
        if (fromRow == 7 && fromCol == 7) rights = rights.Replace("K", "");
        if (fromRow == 0 && fromCol == 0) rights = rights.Replace("q", "");
        if (fromRow == 0 && fromCol == 7) rights = rights.Replace("k", "");

        // Rook captured
        if (toRow == 7 && toCol == 0) rights = rights.Replace("Q", "");
        if (toRow == 7 && toCol == 7) rights = rights.Replace("K", "");
        if (toRow == 0 && toCol == 0) rights = rights.Replace("q", "");
        if (toRow == 0 && toCol == 7) rights = rights.Replace("k", "");

        return string.IsNullOrEmpty(rights) ? "-" : rights;
    }

    private static bool IsInsufficientMaterial(char[,] board)
    {
        var pieces = new List<char>();
        for (int r = 0; r < 8; r++)
            for (int c = 0; c < 8; c++)
                if (!IsEmpty(board[r, c]))
                    pieces.Add(board[r, c]);

        // King vs King
        if (pieces.Count == 2) return true;
        // King + Bishop vs King, King + Knight vs King
        if (pieces.Count == 3)
        {
            var nonKing = pieces.FirstOrDefault(p => char.ToLower(p) != 'k');
            if (char.ToLower(nonKing) == 'b' || char.ToLower(nonKing) == 'n')
                return true;
        }

        return false;
    }

    private static string GenerateAlgebraic(char[,] board, ChessMove move, List<ChessMove> legalMoves, bool isWhite)
    {
        var piece = board[move.FromRow, move.FromCol];
        var target = board[move.ToRow, move.ToCol];
        string toSq = SquareToAlgebraic(move.ToRow, move.ToCol);

        // Castling
        if (move.IsCastling)
        {
            return move.ToCol == 6 ? "O-O" : "O-O-O";
        }

        // Pawn moves
        if (char.ToLower(piece) == 'p')
        {
            string notation = "";
            bool isCapture = !IsEmpty(target) || move.IsEnPassant;
            if (isCapture)
                notation += (char)('a' + move.FromCol) + "x";
            notation += toSq;
            if (move.IsPromotion)
            {
                char promoChar = char.ToUpper(move.PromotionPiece);
                if (promoChar == '\0') promoChar = 'Q';
                notation += "=" + promoChar;
            }
            return notation;
        }

        // Other pieces
        char pieceChar = char.ToUpper(piece);
        string disambig = "";

        // Check if other pieces of the same type can reach the same square
        var ambiguous = legalMoves.Where(m =>
            m.ToRow == move.ToRow && m.ToCol == move.ToCol &&
            board[m.FromRow, m.FromCol] == piece &&
            (m.FromRow != move.FromRow || m.FromCol != move.FromCol)).ToList();

        if (ambiguous.Count > 0)
        {
            bool sameCol = ambiguous.Any(m => m.FromCol == move.FromCol);
            bool sameRow = ambiguous.Any(m => m.FromRow == move.FromRow);
            if (!sameCol)
                disambig = ((char)('a' + move.FromCol)).ToString();
            else if (!sameRow)
                disambig = (8 - move.FromRow).ToString();
            else
                disambig = SquareToAlgebraic(move.FromRow, move.FromCol);
        }

        bool capture = !IsEmpty(target);
        string captureStr = capture ? "x" : "";

        return $"{pieceChar}{disambig}{captureStr}{toSq}";
    }

    private static string PieceToUnicode(char piece) => piece switch
    {
        'K' => "♔", 'Q' => "♕", 'R' => "♖", 'B' => "♗", 'N' => "♘", 'P' => "♙",
        'k' => "♚", 'q' => "♛", 'r' => "♜", 'b' => "♝", 'n' => "♞", 'p' => "♟",
        _ => piece.ToString()
    };
}
