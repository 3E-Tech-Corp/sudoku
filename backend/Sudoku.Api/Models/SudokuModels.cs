namespace Sudoku.Api.Models;

public class SudokuPuzzle
{
    public int Id { get; set; }
    public string Difficulty { get; set; } = "Medium";
    public string InitialBoard { get; set; } = "";
    public string Solution { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class Room
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public int PuzzleId { get; set; }
    public string? HostName { get; set; }
    public string Difficulty { get; set; } = "Medium";
    public string Status { get; set; } = "Active";
    public string? CurrentBoard { get; set; }
    public string? PlayerColors { get; set; }
    public string? Notes { get; set; }
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class RoomMember
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string DisplayName { get; set; } = "";
    public string Color { get; set; } = "";
    public DateTime JoinedAt { get; set; }
}

// API DTOs

public class CreateRoomRequest
{
    public string Difficulty { get; set; } = "Medium";
    public string HostName { get; set; } = "Host";
    public bool IsPublic { get; set; } = false;
}

public class JoinRoomRequest
{
    public string DisplayName { get; set; } = "";
}

public class CreateRoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
}

public class RoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string Status { get; set; } = "";
    public string? HostName { get; set; }
    public int[][] InitialBoard { get; set; } = [];
    public int[][] CurrentBoard { get; set; } = [];
    public int[][] Solution { get; set; } = [];
    public List<MemberResponse> Members { get; set; } = [];
    public Dictionary<string, string> PlayerColors { get; set; } = [];
    public Dictionary<string, int[]> Notes { get; set; } = [];
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class PublicRoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string? HostName { get; set; }
    public int PlayerCount { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class MemberResponse
{
    public string DisplayName { get; set; } = "";
    public string Color { get; set; } = "";
    public DateTime JoinedAt { get; set; }
}

public class JoinRoomResponse
{
    public string DisplayName { get; set; } = "";
    public string Color { get; set; } = "";
    public RoomResponse Room { get; set; } = new();
}

// Cell entry tracks who placed what
public class CellEntry
{
    public int Value { get; set; }
    public string? Player { get; set; }
}
