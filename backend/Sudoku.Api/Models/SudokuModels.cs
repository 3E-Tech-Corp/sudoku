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
    public string Mode { get; set; } = "Cooperative";
    public string GameType { get; set; } = "Sudoku";
    public int? TimeLimitSeconds { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class CompetitiveBoard
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string PlayerName { get; set; } = "";
    public string CurrentBoard { get; set; } = "";
    public string? Notes { get; set; }
    public int FilledCount { get; set; }
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
    public string Mode { get; set; } = "Cooperative";
    public string GameType { get; set; } = "Sudoku";
    public int? TimeLimitSeconds { get; set; }
}

public class JoinRoomRequest
{
    public string DisplayName { get; set; } = "";
}

public class CreateRoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string Mode { get; set; } = "Cooperative";
    public string GameType { get; set; } = "Sudoku";
}

public class RoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string Status { get; set; } = "";
    public string? HostName { get; set; }
    public string Mode { get; set; } = "Cooperative";
    public string GameType { get; set; } = "Sudoku";
    public int? TimeLimitSeconds { get; set; }
    public DateTime? StartedAt { get; set; }
    public int[][] InitialBoard { get; set; } = [];
    public int[][] CurrentBoard { get; set; } = [];
    public int[][] Solution { get; set; } = [];
    public List<MemberResponse> Members { get; set; } = [];
    public Dictionary<string, string> PlayerColors { get; set; } = [];
    public Dictionary<string, int[]> Notes { get; set; } = [];
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    // Competitive-specific fields (populated only in competitive mode)
    public List<PlayerProgress>? Progress { get; set; }
    public string? Winner { get; set; }
    // TwentyFour-specific fields
    public TwentyFourGameState? TwentyFourState { get; set; }
    // Blackjack-specific fields
    public BlackjackGameState? BlackjackState { get; set; }
}

public class PublicRoomResponse
{
    public string Code { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string? HostName { get; set; }
    public string Mode { get; set; } = "Cooperative";
    public string GameType { get; set; } = "Sudoku";
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

public class PlayerProgress
{
    public string DisplayName { get; set; } = "";
    public string Color { get; set; } = "";
    public int FilledCount { get; set; }
    public int TotalCells { get; set; } = 81;
    public bool IsCompleted { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int? Rank { get; set; }
}

// Cell entry tracks who placed what
public class CellEntry
{
    public int Value { get; set; }
    public string? Player { get; set; }
}

// ========== TwentyFour Game Models ==========

public class TwentyFourCard
{
    public int Number { get; set; }     // 1-13
    public string Suit { get; set; } = ""; // Hearts, Diamonds, Clubs, Spades
}

public class TwentyFourStep
{
    public int Card1 { get; set; }
    public string Operation { get; set; } = "";  // +, -, *, /
    public int Card2 { get; set; }
    public int Result { get; set; }
}

public class TwentyFourGameState
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string CardsJson { get; set; } = "[]";  // JSON array of TwentyFourCard
    public string DeckJson { get; set; } = "[]";   // remaining deck
    public int HandNumber { get; set; } = 1;
    public string Status { get; set; } = "Playing"; // Playing, Won, Skipped
    public string? WinnerName { get; set; }
    public string? WinningStepsJson { get; set; }
    public DateTime CreatedAt { get; set; }

    // Scores stored as JSON: { "Player1": 5, "Player2": 3 }
    public string ScoresJson { get; set; } = "{}";
}

public class TwentyFourPlayerState
{
    public int Id { get; set; }
    public int GameStateId { get; set; }
    public string PlayerName { get; set; } = "";
    public int CompletedRows { get; set; } = 0;
    public string? StepsJson { get; set; }   // current in-progress steps
}

// ========== Blackjack Game Models ==========

public class BlackjackCard
{
    public int Rank { get; set; }   // 1=A, 2-10, 11=J, 12=Q, 13=K
    public string Suit { get; set; } = "";
}

public class BlackjackPlayer
{
    public string PlayerName { get; set; } = "";
    public List<BlackjackCard> Cards { get; set; } = [];
    public int Bet { get; set; }
    public int Chips { get; set; } = 1000;
    public string Status { get; set; } = "Waiting"; // Waiting, Playing, Standing, Bust, Blackjack, Won, Lost, Push
    public int InsuranceBet { get; set; }
}

public class BlackjackGameState
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string DeckJson { get; set; } = "[]";
    public string DealerHandJson { get; set; } = "[]";
    public bool DealerRevealed { get; set; }
    public string Phase { get; set; } = "Betting"; // Betting, Playing, DealerTurn, Payout
    public int CurrentPlayerIndex { get; set; }
    public string PlayersJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; }
}

public class BlackjackStateResponse
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public List<BlackjackCard> DealerHand { get; set; } = [];
    public bool DealerRevealed { get; set; }
    public string Phase { get; set; } = "Betting";
    public int CurrentPlayerIndex { get; set; }
    public List<BlackjackPlayer> Players { get; set; } = [];
}

public class Complete24RowRequest
{
    public int Row { get; set; }       // 0, 1, or 2
    public int Card1 { get; set; }
    public string Operation { get; set; } = "";
    public int Card2 { get; set; }
    public int Result { get; set; }
}

public class Win24GameRequest
{
    public List<TwentyFourStep> Steps { get; set; } = [];
}

// ========== Blackjack Game Models ==========

public class BlackjackCard
{
    public int Rank { get; set; }       // 1-13 (1=Ace, 11=J, 12=Q, 13=K)
    public string Suit { get; set; } = "";  // Hearts, Diamonds, Clubs, Spades
}

public class BlackjackPlayer
{
    public string PlayerName { get; set; } = "";
    public List<BlackjackCard> Cards { get; set; } = [];
    public int Bet { get; set; }
    public int Chips { get; set; } = 1000;
    public string Status { get; set; } = "Waiting"; // Waiting, Playing, Standing, Bust, Blackjack, Won, Lost, Push
    public int InsuranceBet { get; set; }
}

public class BlackjackGameState
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string DeckJson { get; set; } = "[]";
    public string DealerHandJson { get; set; } = "[]";
    public bool DealerRevealed { get; set; }
    public string Phase { get; set; } = "Betting"; // Betting, Playing, DealerTurn, Payout
    public int CurrentPlayerIndex { get; set; }
    public string PlayersJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; }
}
