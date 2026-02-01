using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class RoomService
{
    private readonly string _connectionString;
    private readonly SudokuGenerator _generator;
    private static readonly Random _rng = new();

    private static readonly string[] PlayerColors = [
        "#3B82F6", // blue
        "#EF4444", // red
        "#10B981", // green
        "#F59E0B", // amber
        "#8B5CF6", // purple
        "#EC4899", // pink
        "#06B6D4", // cyan
        "#F97316", // orange
    ];

    private readonly TwentyFourService _twentyFourService;

    public RoomService(IConfiguration config, SudokuGenerator generator, TwentyFourService twentyFourService)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
        _generator = generator;
        _twentyFourService = twentyFourService;
    }

    private SqlConnection GetConnection() => new(_connectionString);

    private string GenerateCode()
    {
        const string chars = "0123456789";
        return new string(Enumerable.Range(0, 6).Select(_ => chars[_rng.Next(chars.Length)]).ToArray());
    }

    public async Task<CreateRoomResponse> CreateRoom(CreateRoomRequest request)
    {
        var gameType = request.GameType == "TwentyFour" ? "TwentyFour" : "Sudoku";
        var code = GenerateCode();
        var mode = request.Mode switch
        {
            "Competitive" => "Competitive",
            "Practice" => "Practice",
            _ => "Cooperative"
        };

        using var conn = GetConnection();
        await conn.OpenAsync();

        int puzzleId;
        string puzzleJson;

        if (gameType == "TwentyFour")
        {
            // For 24 game, create a dummy puzzle entry (no board needed)
            puzzleJson = "[]";
            puzzleId = await conn.QuerySingleAsync<int>(@"
                INSERT INTO SudokuPuzzles (Difficulty, InitialBoard, Solution)
                OUTPUT INSERTED.Id
                VALUES (@Difficulty, '[]', '[]')",
                new { Difficulty = "N/A" });
        }
        else
        {
            var (puzzle, solution) = _generator.Generate(request.Difficulty);
            puzzleJson = JsonSerializer.Serialize(puzzle);
            var solutionJson = JsonSerializer.Serialize(solution);

            puzzleId = await conn.QuerySingleAsync<int>(@"
                INSERT INTO SudokuPuzzles (Difficulty, InitialBoard, Solution)
                OUTPUT INSERTED.Id
                VALUES (@Difficulty, @InitialBoard, @Solution)",
                new { request.Difficulty, InitialBoard = puzzleJson, Solution = solutionJson });
        }

        // Create room
        var initialColors = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(request.HostName))
        {
            initialColors[request.HostName] = PlayerColors[0];
        }

        await conn.ExecuteAsync(@"
            INSERT INTO Rooms (Code, PuzzleId, HostName, Difficulty, Status, CurrentBoard, PlayerColors, IsPublic, Mode, GameType, TimeLimitSeconds)
            VALUES (@Code, @PuzzleId, @HostName, @Difficulty, 'Active', @CurrentBoard, @PlayerColors, @IsPublic, @Mode, @GameType, @TimeLimitSeconds)",
            new
            {
                Code = code,
                PuzzleId = puzzleId,
                request.HostName,
                Difficulty = gameType == "TwentyFour" ? "N/A" : request.Difficulty,
                CurrentBoard = puzzleJson,
                PlayerColors = JsonSerializer.Serialize(initialColors),
                request.IsPublic,
                Mode = mode,
                GameType = gameType,
                request.TimeLimitSeconds
            });

        // Add host as member if name provided
        if (!string.IsNullOrEmpty(request.HostName))
        {
            var room = await conn.QuerySingleAsync<Room>("SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
            await conn.ExecuteAsync(@"
                INSERT INTO RoomMembers (RoomId, DisplayName, Color)
                VALUES (@RoomId, @DisplayName, @Color)",
                new { RoomId = room.Id, DisplayName = request.HostName, Color = PlayerColors[0] });

            if (gameType == "Sudoku" && mode == "Competitive")
            {
                await CreateCompetitiveBoard(conn, room.Id, request.HostName, puzzleJson);
            }

            // Initialize 24 game state
            if (gameType == "TwentyFour")
            {
                await _twentyFourService.InitializeGame(room.Id);
            }
        }

        return new CreateRoomResponse { Code = code, Difficulty = request.Difficulty, Mode = mode, GameType = gameType };
    }

    private async Task CreateCompetitiveBoard(SqlConnection conn, int roomId, string playerName, string initialBoard)
    {
        // Check if already exists
        var existing = await conn.QuerySingleOrDefaultAsync<CompetitiveBoard>(
            "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId AND PlayerName = @PlayerName",
            new { RoomId = roomId, PlayerName = playerName });
        if (existing != null) return;

        // Count given cells (non-zero cells in initial board are pre-filled)
        var board = JsonSerializer.Deserialize<int[][]>(initialBoard)!;
        int givenCount = 0;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (board[r][c] != 0) givenCount++;

        await conn.ExecuteAsync(@"
            INSERT INTO CompetitiveBoards (RoomId, PlayerName, CurrentBoard, FilledCount)
            VALUES (@RoomId, @PlayerName, @CurrentBoard, @FilledCount)",
            new { RoomId = roomId, PlayerName = playerName, CurrentBoard = initialBoard, FilledCount = givenCount });
    }

    public async Task<RoomResponse?> GetRoom(string code, string? playerName = null)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null) return null;

        var members = (await conn.QueryAsync<RoomMember>(
            "SELECT * FROM RoomMembers WHERE RoomId = @RoomId ORDER BY JoinedAt",
            new { RoomId = room.Id })).ToList();

        var playerColors = string.IsNullOrEmpty(room.PlayerColors)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(room.PlayerColors) ?? new();

        var memberResponses = members.Select(m => new MemberResponse
        {
            DisplayName = m.DisplayName,
            Color = m.Color,
            JoinedAt = m.JoinedAt
        }).ToList();

        // Handle TwentyFour game type
        if (room.GameType == "TwentyFour")
        {
            var gameState = await _twentyFourService.GetGameState(room.Id);
            return new RoomResponse
            {
                Code = room.Code,
                Difficulty = "N/A",
                Status = room.Status,
                HostName = room.HostName,
                Mode = room.Mode,
                GameType = room.GameType,
                TimeLimitSeconds = room.TimeLimitSeconds,
                StartedAt = room.StartedAt,
                InitialBoard = [],
                CurrentBoard = [],
                Solution = [],
                Members = memberResponses,
                PlayerColors = playerColors,
                Notes = new(),
                IsPublic = room.IsPublic,
                CreatedAt = room.CreatedAt,
                CompletedAt = room.CompletedAt,
                TwentyFourState = gameState
            };
        }

        // Sudoku logic (unchanged)
        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var initialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard) ?? [];

        // For competitive mode, return the player's own board and no solution
        if (room.Mode == "Competitive")
        {
            int[][] currentBoard = initialBoard;
            Dictionary<string, int[]> notes = new();

            if (!string.IsNullOrEmpty(playerName))
            {
                var compBoard = await conn.QuerySingleOrDefaultAsync<CompetitiveBoard>(
                    "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId AND PlayerName = @PlayerName",
                    new { RoomId = room.Id, PlayerName = playerName });

                if (compBoard != null)
                {
                    currentBoard = JsonSerializer.Deserialize<int[][]>(compBoard.CurrentBoard) ?? initialBoard;
                    notes = string.IsNullOrEmpty(compBoard.Notes)
                        ? new Dictionary<string, int[]>()
                        : JsonSerializer.Deserialize<Dictionary<string, int[]>>(compBoard.Notes) ?? new();
                }
            }

            // Get progress for all players
            var progress = await GetProgressInternal(conn, room.Id, playerColors);

            // Find winner
            string? winner = null;
            var completedPlayers = progress.Where(p => p.IsCompleted).OrderBy(p => p.CompletedAt).ToList();
            if (completedPlayers.Any())
            {
                winner = completedPlayers.First().DisplayName;
            }

            return new RoomResponse
            {
                Code = room.Code,
                Difficulty = room.Difficulty,
                Status = room.Status,
                HostName = room.HostName,
                Mode = room.Mode,
                GameType = room.GameType,
                TimeLimitSeconds = room.TimeLimitSeconds,
                StartedAt = room.StartedAt,
                InitialBoard = initialBoard,
                CurrentBoard = currentBoard,
                Solution = [], // Don't send solution in competitive mode
                Members = memberResponses,
                PlayerColors = playerColors,
                Notes = notes,
                IsPublic = room.IsPublic,
                CreatedAt = room.CreatedAt,
                CompletedAt = room.CompletedAt,
                Progress = progress,
                Winner = winner
            };
        }

        // Cooperative mode (unchanged)
        var coopNotes = string.IsNullOrEmpty(room.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(room.Notes) ?? new();

        return new RoomResponse
        {
            Code = room.Code,
            Difficulty = room.Difficulty,
            Status = room.Status,
            HostName = room.HostName,
            Mode = room.Mode,
            GameType = room.GameType,
            TimeLimitSeconds = room.TimeLimitSeconds,
            StartedAt = room.StartedAt,
            InitialBoard = initialBoard,
            CurrentBoard = JsonSerializer.Deserialize<int[][]>(room.CurrentBoard ?? puzzle.InitialBoard) ?? [],
            Solution = JsonSerializer.Deserialize<int[][]>(puzzle.Solution) ?? [],
            Members = memberResponses,
            PlayerColors = playerColors,
            Notes = coopNotes,
            IsPublic = room.IsPublic,
            CreatedAt = room.CreatedAt,
            CompletedAt = room.CompletedAt
        };
    }

    public async Task<JoinRoomResponse?> JoinRoom(string code, JoinRoomRequest request)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null) return null;

        // Check if already a member
        var existing = await conn.QuerySingleOrDefaultAsync<RoomMember>(
            "SELECT * FROM RoomMembers WHERE RoomId = @RoomId AND DisplayName = @DisplayName",
            new { RoomId = room.Id, DisplayName = request.DisplayName });

        if (existing != null)
        {
            var roomResp = await GetRoom(code, request.DisplayName);
            return new JoinRoomResponse
            {
                DisplayName = existing.DisplayName,
                Color = existing.Color,
                Room = roomResp!
            };
        }

        // Assign color
        var memberCount = await conn.QuerySingleAsync<int>(
            "SELECT COUNT(*) FROM RoomMembers WHERE RoomId = @RoomId", new { RoomId = room.Id });
        var color = PlayerColors[memberCount % PlayerColors.Length];

        await conn.ExecuteAsync(@"
            INSERT INTO RoomMembers (RoomId, DisplayName, Color)
            VALUES (@RoomId, @DisplayName, @Color)",
            new { RoomId = room.Id, DisplayName = request.DisplayName, Color = color });

        // Update player colors
        var playerColors = string.IsNullOrEmpty(room.PlayerColors)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(room.PlayerColors) ?? new();
        playerColors[request.DisplayName] = color;

        await conn.ExecuteAsync(
            "UPDATE Rooms SET PlayerColors = @PlayerColors WHERE Id = @Id",
            new { PlayerColors = JsonSerializer.Serialize(playerColors), room.Id });

        // If competitive Sudoku, create a competitive board for this player
        if (room.Mode == "Competitive" && room.GameType == "Sudoku")
        {
            var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
                "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });
            await CreateCompetitiveBoard(conn, room.Id, request.DisplayName, puzzle.InitialBoard);
        }

        // If TwentyFour game and no game state exists yet, initialize it
        if (room.GameType == "TwentyFour")
        {
            var existingState = await _twentyFourService.GetGameState(room.Id);
            if (existingState == null)
            {
                await _twentyFourService.InitializeGame(room.Id);
            }
        }

        var roomResponse = await GetRoom(code, request.DisplayName);
        return new JoinRoomResponse
        {
            DisplayName = request.DisplayName,
            Color = color,
            Room = roomResponse!
        };
    }

    public async Task<bool> PlaceNumber(string code, int row, int col, int value, string player)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return false;

        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var initialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard)!;

        // Can't overwrite given cells
        if (initialBoard[row][col] != 0) return false;

        var currentBoard = JsonSerializer.Deserialize<int[][]>(room.CurrentBoard ?? puzzle.InitialBoard)!;
        currentBoard[row][col] = value;

        // Clear notes for this cell when a number is placed
        var notesDict = string.IsNullOrEmpty(room.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(room.Notes) ?? new();
        var cellKey = $"{row},{col}";
        notesDict.Remove(cellKey);

        var boardJson = JsonSerializer.Serialize(currentBoard);
        var notesJson = JsonSerializer.Serialize(notesDict);

        // Check if puzzle is complete
        var solution = JsonSerializer.Deserialize<int[][]>(puzzle.Solution)!;
        bool isComplete = true;
        for (int r = 0; r < 9 && isComplete; r++)
            for (int c = 0; c < 9 && isComplete; c++)
                if (currentBoard[r][c] != solution[r][c])
                    isComplete = false;

        if (isComplete)
        {
            await conn.ExecuteAsync(
                "UPDATE Rooms SET CurrentBoard = @Board, Notes = @Notes, Status = 'Completed', CompletedAt = GETUTCDATE() WHERE Id = @Id",
                new { Board = boardJson, Notes = notesJson, room.Id });
        }
        else
        {
            await conn.ExecuteAsync(
                "UPDATE Rooms SET CurrentBoard = @Board, Notes = @Notes WHERE Id = @Id",
                new { Board = boardJson, Notes = notesJson, room.Id });
        }

        return isComplete;
    }

    public async Task<(bool isComplete, int filledCount, int rank)> CompetitivePlaceNumber(string code, string playerName, int row, int col, int value)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return (false, 0, 0);

        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var initialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard)!;
        if (initialBoard[row][col] != 0) return (false, 0, 0);

        var compBoard = await conn.QuerySingleOrDefaultAsync<CompetitiveBoard>(
            "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId AND PlayerName = @PlayerName",
            new { RoomId = room.Id, PlayerName = playerName });
        if (compBoard == null || compBoard.CompletedAt != null) return (false, 0, 0);

        var currentBoard = JsonSerializer.Deserialize<int[][]>(compBoard.CurrentBoard)!;
        currentBoard[row][col] = value;

        // Clear notes for this cell
        var notesDict = string.IsNullOrEmpty(compBoard.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(compBoard.Notes) ?? new();
        notesDict.Remove($"{row},{col}");

        // Count filled cells (non-zero)
        int filledCount = 0;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (currentBoard[r][c] != 0) filledCount++;

        // Check if puzzle is complete (matches solution)
        var solution = JsonSerializer.Deserialize<int[][]>(puzzle.Solution)!;
        bool isComplete = true;
        for (int r = 0; r < 9 && isComplete; r++)
            for (int c = 0; c < 9 && isComplete; c++)
                if (currentBoard[r][c] != solution[r][c])
                    isComplete = false;

        var boardJson = JsonSerializer.Serialize(currentBoard);
        var notesJson = JsonSerializer.Serialize(notesDict);

        int rank = 0;
        if (isComplete)
        {
            // Determine rank
            var completedCount = await conn.QuerySingleAsync<int>(
                "SELECT COUNT(*) FROM CompetitiveBoards WHERE RoomId = @RoomId AND CompletedAt IS NOT NULL",
                new { RoomId = room.Id });
            rank = completedCount + 1;

            await conn.ExecuteAsync(@"
                UPDATE CompetitiveBoards 
                SET CurrentBoard = @Board, Notes = @Notes, FilledCount = @FilledCount, CompletedAt = GETUTCDATE() 
                WHERE Id = @Id",
                new { Board = boardJson, Notes = notesJson, FilledCount = filledCount, compBoard.Id });

            // Check if all players have completed
            var totalPlayers = await conn.QuerySingleAsync<int>(
                "SELECT COUNT(*) FROM CompetitiveBoards WHERE RoomId = @RoomId",
                new { RoomId = room.Id });
            if (completedCount + 1 >= totalPlayers)
            {
                await conn.ExecuteAsync(
                    "UPDATE Rooms SET Status = 'Completed', CompletedAt = GETUTCDATE() WHERE Id = @Id",
                    new { room.Id });
            }
        }
        else
        {
            await conn.ExecuteAsync(@"
                UPDATE CompetitiveBoards 
                SET CurrentBoard = @Board, Notes = @Notes, FilledCount = @FilledCount 
                WHERE Id = @Id",
                new { Board = boardJson, Notes = notesJson, FilledCount = filledCount, compBoard.Id });
        }

        return (isComplete, filledCount, rank);
    }

    public async Task<int> CompetitiveEraseNumber(string code, string playerName, int row, int col)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return 0;

        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var initialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard)!;
        if (initialBoard[row][col] != 0) return 0;

        var compBoard = await conn.QuerySingleOrDefaultAsync<CompetitiveBoard>(
            "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId AND PlayerName = @PlayerName",
            new { RoomId = room.Id, PlayerName = playerName });
        if (compBoard == null || compBoard.CompletedAt != null) return 0;

        var currentBoard = JsonSerializer.Deserialize<int[][]>(compBoard.CurrentBoard)!;
        currentBoard[row][col] = 0;

        // Count filled cells
        int filledCount = 0;
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (currentBoard[r][c] != 0) filledCount++;

        var boardJson = JsonSerializer.Serialize(currentBoard);

        await conn.ExecuteAsync(@"
            UPDATE CompetitiveBoards 
            SET CurrentBoard = @Board, FilledCount = @FilledCount 
            WHERE Id = @Id",
            new { Board = boardJson, FilledCount = filledCount, compBoard.Id });

        return filledCount;
    }

    public async Task CompetitiveToggleNote(string code, string playerName, int row, int col, int value)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return;

        var compBoard = await conn.QuerySingleOrDefaultAsync<CompetitiveBoard>(
            "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId AND PlayerName = @PlayerName",
            new { RoomId = room.Id, PlayerName = playerName });
        if (compBoard == null || compBoard.CompletedAt != null) return;

        var notesDict = string.IsNullOrEmpty(compBoard.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(compBoard.Notes) ?? new();

        var cellKey = $"{row},{col}";
        var cellNotes = notesDict.ContainsKey(cellKey) ? new HashSet<int>(notesDict[cellKey]) : new HashSet<int>();

        if (cellNotes.Contains(value))
            cellNotes.Remove(value);
        else
            cellNotes.Add(value);

        if (cellNotes.Count > 0)
            notesDict[cellKey] = cellNotes.OrderBy(n => n).ToArray();
        else
            notesDict.Remove(cellKey);

        await conn.ExecuteAsync(
            "UPDATE CompetitiveBoards SET Notes = @Notes WHERE Id = @Id",
            new { Notes = JsonSerializer.Serialize(notesDict), compBoard.Id });
    }

    public async Task<string?> GetRoomMode(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        return room?.Mode;
    }

    public async Task<(string? gameType, string? mode)> GetRoomInfo(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        return (room?.GameType, room?.Mode);
    }

    public async Task<Room?> GetRoomByCode(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
    }

    private async Task<List<PlayerProgress>> GetProgressInternal(SqlConnection conn, int roomId, Dictionary<string, string> playerColors)
    {
        var boards = (await conn.QueryAsync<CompetitiveBoard>(
            "SELECT * FROM CompetitiveBoards WHERE RoomId = @RoomId",
            new { RoomId = roomId })).ToList();

        var completedBoards = boards.Where(b => b.CompletedAt != null).OrderBy(b => b.CompletedAt).ToList();

        return boards.Select(b =>
        {
            var rank = b.CompletedAt != null
                ? completedBoards.FindIndex(cb => cb.PlayerName == b.PlayerName) + 1
                : (int?)null;

            return new PlayerProgress
            {
                DisplayName = b.PlayerName,
                Color = playerColors.GetValueOrDefault(b.PlayerName, "#3B82F6"),
                FilledCount = b.FilledCount,
                TotalCells = 81,
                IsCompleted = b.CompletedAt != null,
                CompletedAt = b.CompletedAt,
                Rank = rank
            };
        }).ToList();
    }

    public async Task<List<PlayerProgress>> GetProgress(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null) return [];

        var playerColors = string.IsNullOrEmpty(room.PlayerColors)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(room.PlayerColors) ?? new();

        return await GetProgressInternal(conn, room.Id, playerColors);
    }

    public async Task<List<PublicRoomResponse>> ListPublicRooms(string? gameType = null)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var sql = "SELECT * FROM Rooms WHERE IsPublic = 1 AND Status = 'Active'";
        if (!string.IsNullOrEmpty(gameType))
        {
            sql += " AND GameType = @GameType";
        }
        sql += " ORDER BY CreatedAt DESC";

        var rooms = await conn.QueryAsync<Room>(sql, new { GameType = gameType });

        var result = new List<PublicRoomResponse>();
        foreach (var room in rooms)
        {
            var memberCount = await conn.QuerySingleAsync<int>(
                "SELECT COUNT(*) FROM RoomMembers WHERE RoomId = @RoomId", new { RoomId = room.Id });
            result.Add(new PublicRoomResponse
            {
                Code = room.Code,
                Difficulty = room.Difficulty,
                HostName = room.HostName,
                Mode = room.Mode,
                GameType = room.GameType,
                PlayerCount = memberCount,
                CreatedAt = room.CreatedAt
            });
        }
        return result;
    }

    public async Task<int[]> ToggleNote(string code, int row, int col, int value)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return [];

        var notesDict = string.IsNullOrEmpty(room.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(room.Notes) ?? new();

        var cellKey = $"{row},{col}";
        var cellNotes = notesDict.ContainsKey(cellKey) ? new HashSet<int>(notesDict[cellKey]) : new HashSet<int>();

        if (cellNotes.Contains(value))
            cellNotes.Remove(value);
        else
            cellNotes.Add(value);

        if (cellNotes.Count > 0)
            notesDict[cellKey] = cellNotes.OrderBy(n => n).ToArray();
        else
            notesDict.Remove(cellKey);

        await conn.ExecuteAsync(
            "UPDATE Rooms SET Notes = @Notes WHERE Id = @Id",
            new { Notes = JsonSerializer.Serialize(notesDict), room.Id });

        return cellNotes.OrderBy(n => n).ToArray();
    }

    public async Task<DateTime?> StartTimer(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var now = DateTime.UtcNow;
        var affected = await conn.ExecuteAsync(
            "UPDATE Rooms SET StartedAt = @StartedAt WHERE Code = @Code AND StartedAt IS NULL",
            new { StartedAt = now, Code = code });

        if (affected > 0) return now;

        // Already started — return existing
        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        return room?.StartedAt;
    }

    public async Task ClearNotes(string code, int row, int col)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null) return;

        var notesDict = string.IsNullOrEmpty(room.Notes)
            ? new Dictionary<string, int[]>()
            : JsonSerializer.Deserialize<Dictionary<string, int[]>>(room.Notes) ?? new();

        var cellKey = $"{row},{col}";
        if (notesDict.Remove(cellKey))
        {
            await conn.ExecuteAsync(
                "UPDATE Rooms SET Notes = @Notes WHERE Id = @Id",
                new { Notes = JsonSerializer.Serialize(notesDict), room.Id });
        }
    }

    public async Task<bool> EraseNumber(string code, int row, int col)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null || room.Status != "Active") return false;

        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var initialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard)!;

        // Can't erase given cells
        if (initialBoard[row][col] != 0) return false;

        var currentBoard = JsonSerializer.Deserialize<int[][]>(room.CurrentBoard ?? puzzle.InitialBoard)!;
        currentBoard[row][col] = 0;

        await conn.ExecuteAsync(
            "UPDATE Rooms SET CurrentBoard = @Board WHERE Id = @Id",
            new { Board = JsonSerializer.Serialize(currentBoard), room.Id });

        return true;
    }
}
