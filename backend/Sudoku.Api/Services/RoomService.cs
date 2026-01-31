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

    public RoomService(IConfiguration config, SudokuGenerator generator)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
        _generator = generator;
    }

    private SqlConnection GetConnection() => new(_connectionString);

    private string GenerateCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, 6).Select(_ => chars[_rng.Next(chars.Length)]).ToArray());
    }

    public async Task<CreateRoomResponse> CreateRoom(CreateRoomRequest request)
    {
        var (puzzle, solution) = _generator.Generate(request.Difficulty);

        var puzzleJson = JsonSerializer.Serialize(puzzle);
        var solutionJson = JsonSerializer.Serialize(solution);
        var code = GenerateCode();

        using var conn = GetConnection();
        await conn.OpenAsync();

        // Insert puzzle
        var puzzleId = await conn.QuerySingleAsync<int>(@"
            INSERT INTO SudokuPuzzles (Difficulty, InitialBoard, Solution)
            OUTPUT INSERTED.Id
            VALUES (@Difficulty, @InitialBoard, @Solution)",
            new { request.Difficulty, InitialBoard = puzzleJson, Solution = solutionJson });

        // Create room with initial board = puzzle (same as initial)
        var initialColors = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(request.HostName))
        {
            initialColors[request.HostName] = PlayerColors[0];
        }

        await conn.ExecuteAsync(@"
            INSERT INTO Rooms (Code, PuzzleId, HostName, Difficulty, Status, CurrentBoard, PlayerColors)
            VALUES (@Code, @PuzzleId, @HostName, @Difficulty, 'Active', @CurrentBoard, @PlayerColors)",
            new
            {
                Code = code,
                PuzzleId = puzzleId,
                request.HostName,
                request.Difficulty,
                CurrentBoard = puzzleJson,
                PlayerColors = JsonSerializer.Serialize(initialColors)
            });

        // Add host as member if name provided
        if (!string.IsNullOrEmpty(request.HostName))
        {
            var room = await conn.QuerySingleAsync<Room>("SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
            await conn.ExecuteAsync(@"
                INSERT INTO RoomMembers (RoomId, DisplayName, Color)
                VALUES (@RoomId, @DisplayName, @Color)",
                new { RoomId = room.Id, DisplayName = request.HostName, Color = PlayerColors[0] });
        }

        return new CreateRoomResponse { Code = code, Difficulty = request.Difficulty };
    }

    public async Task<RoomResponse?> GetRoom(string code)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var room = await conn.QuerySingleOrDefaultAsync<Room>(
            "SELECT * FROM Rooms WHERE Code = @Code", new { Code = code });
        if (room == null) return null;

        var puzzle = await conn.QuerySingleAsync<SudokuPuzzle>(
            "SELECT * FROM SudokuPuzzles WHERE Id = @Id", new { Id = room.PuzzleId });

        var members = (await conn.QueryAsync<RoomMember>(
            "SELECT * FROM RoomMembers WHERE RoomId = @RoomId ORDER BY JoinedAt",
            new { RoomId = room.Id })).ToList();

        var playerColors = string.IsNullOrEmpty(room.PlayerColors)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(room.PlayerColors) ?? new();

        return new RoomResponse
        {
            Code = room.Code,
            Difficulty = room.Difficulty,
            Status = room.Status,
            HostName = room.HostName,
            InitialBoard = JsonSerializer.Deserialize<int[][]>(puzzle.InitialBoard) ?? [],
            CurrentBoard = JsonSerializer.Deserialize<int[][]>(room.CurrentBoard ?? puzzle.InitialBoard) ?? [],
            Solution = JsonSerializer.Deserialize<int[][]>(puzzle.Solution) ?? [],
            Members = members.Select(m => new MemberResponse
            {
                DisplayName = m.DisplayName,
                Color = m.Color,
                JoinedAt = m.JoinedAt
            }).ToList(),
            PlayerColors = playerColors,
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
            var roomResp = await GetRoom(code);
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

        var roomResponse = await GetRoom(code);
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

        var boardJson = JsonSerializer.Serialize(currentBoard);

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
                "UPDATE Rooms SET CurrentBoard = @Board, Status = 'Completed', CompletedAt = GETUTCDATE() WHERE Id = @Id",
                new { Board = boardJson, room.Id });
        }
        else
        {
            await conn.ExecuteAsync(
                "UPDATE Rooms SET CurrentBoard = @Board WHERE Id = @Id",
                new { Board = boardJson, room.Id });
        }

        return isComplete;
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
