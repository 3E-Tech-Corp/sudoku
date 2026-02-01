using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Sudoku.Api.Models;
using Sudoku.Api.Services;

namespace Sudoku.Api.Hubs;

public class GameHub : Hub
{
    private readonly RoomService _roomService;
    private readonly TwentyFourService _twentyFourService;

    // Track connection → (roomCode, displayName) for peer list
    private static readonly ConcurrentDictionary<string, (string RoomCode, string DisplayName)> _connections = new();

    public GameHub(RoomService roomService, TwentyFourService twentyFourService)
    {
        _roomService = roomService;
        _twentyFourService = twentyFourService;
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_connections.TryRemove(Context.ConnectionId, out var info))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, info.RoomCode);
            await Clients.Group(info.RoomCode).SendAsync("PlayerLeft", info.DisplayName);
            await Clients.Group(info.RoomCode).SendAsync("PeerLeft", Context.ConnectionId, info.DisplayName);
        }
        await base.OnDisconnectedAsync(exception);
    }

    // ==================== Room methods ====================

    public async Task JoinRoom(string code, string displayName)
    {
        code = code.ToUpper();
        _connections[Context.ConnectionId] = (code, displayName);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Group(code).SendAsync("PlayerJoined", displayName);
        await Clients.Group(code).SendAsync("PeerJoined", Context.ConnectionId, displayName);
    }

    public async Task LeaveRoom(string code, string displayName)
    {
        code = code.ToUpper();
        _connections.TryRemove(Context.ConnectionId, out _);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, code);
        await Clients.Group(code).SendAsync("PlayerLeft", displayName);
        await Clients.Group(code).SendAsync("PeerLeft", Context.ConnectionId, displayName);
    }

    // ==================== Sudoku methods (from SudokuHub) ====================

    public async Task PlaceNumber(string code, int row, int col, int value, string player)
    {
        code = code.ToUpper();
        var mode = await _roomService.GetRoomMode(code);

        if (mode == "Competitive")
        {
            var (isComplete, filledCount, rank) = await _roomService.CompetitivePlaceNumber(code, player, row, col, value);
            await Clients.Group(code).SendAsync("ProgressUpdated", player, filledCount);
            await Clients.Caller.SendAsync("CompetitiveMoveConfirmed", row, col, value);

            if (isComplete)
            {
                await Clients.Group(code).SendAsync("PlayerFinished", player, rank);
                if (rank == 1)
                {
                    await Clients.Group(code).SendAsync("CompetitionWinner", player);
                }
            }
        }
        else
        {
            var isComplete = await _roomService.PlaceNumber(code, row, col, value, player);
            await Clients.Group(code).SendAsync("NumberPlaced", row, col, value, player);

            if (isComplete)
            {
                await Clients.Group(code).SendAsync("PuzzleCompleted");
            }
        }
    }

    public async Task EraseNumber(string code, int row, int col, string player)
    {
        code = code.ToUpper();
        var mode = await _roomService.GetRoomMode(code);

        if (mode == "Competitive")
        {
            var filledCount = await _roomService.CompetitiveEraseNumber(code, player, row, col);
            await Clients.Group(code).SendAsync("ProgressUpdated", player, filledCount);
            await Clients.Caller.SendAsync("CompetitiveEraseConfirmed", row, col);
        }
        else
        {
            await _roomService.EraseNumber(code, row, col);
            await Clients.Group(code).SendAsync("NumberErased", row, col, player);
        }
    }

    public async Task ToggleNote(string code, int row, int col, int value, string player)
    {
        code = code.ToUpper();
        var mode = await _roomService.GetRoomMode(code);

        if (mode == "Competitive")
        {
            await _roomService.CompetitiveToggleNote(code, player, row, col, value);
        }
        else
        {
            var updatedNotes = await _roomService.ToggleNote(code, row, col, value);
            await Clients.Group(code).SendAsync("NoteUpdated", row, col, updatedNotes, player);
        }
    }

    // ==================== 24-Game methods ====================

    /// <summary>
    /// Host triggers dealing new 24-game cards
    /// </summary>
    public async Task Deal24Cards(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "TwentyFour") return;

        var gameState = await _twentyFourService.GetGameState(room.Id);
        if (gameState == null)
        {
            gameState = await _twentyFourService.InitializeGame(room.Id);
        }

        var cards = JsonSerializer.Deserialize<List<TwentyFourCard>>(gameState.CardsJson);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(cards),
            gameState.HandNumber,
            gameState.ScoresJson);
    }

    /// <summary>
    /// Submit a single step in cooperative mode
    /// </summary>
    public async Task Submit24Step(string code, string player, int row, int card1, string op, int card2)
    {
        code = code.ToUpper();

        var result = TwentyFourService.ValidateStep(card1, op, card2, 0);
        // Compute actual result
        int? computedResult = op switch
        {
            "+" => card1 + card2,
            "-" => card1 - card2 > 0 ? card1 - card2 : null,
            "*" => card1 * card2,
            "/" when card2 != 0 && card1 % card2 == 0 => card1 / card2 > 0 ? card1 / card2 : null,
            _ => null
        };

        if (computedResult == null)
        {
            await Clients.Caller.SendAsync("24Error", "Invalid operation — result must be a positive integer");
            return;
        }

        var (gameType, mode) = await _roomService.GetRoomInfo(code);
        if (gameType != "TwentyFour") return;

        if (mode == "Cooperative")
        {
            await Clients.Group(code).SendAsync("24RowCompleted", player, row, card1, op, card2, computedResult.Value);
        }
        else
        {
            await Clients.Group(code).SendAsync("24ProgressUpdated", player, row + 1);
        }
    }

    /// <summary>
    /// Submit a complete 3-step solution (competitive mode: first valid solution wins)
    /// </summary>
    public async Task Submit24Solution(string code, string player, string stepsJson)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "TwentyFour") return;

        var steps = JsonSerializer.Deserialize<List<TwentyFourStep>>(stepsJson);
        if (steps == null || steps.Count != 3)
        {
            await Clients.Caller.SendAsync("24Error", "Invalid solution format");
            return;
        }

        var gameState = await _twentyFourService.GetGameState(room.Id);
        if (gameState == null || gameState.Status != "Playing")
        {
            await Clients.Caller.SendAsync("24Error", "No active hand");
            return;
        }

        var cards = JsonSerializer.Deserialize<List<TwentyFourCard>>(gameState.CardsJson);
        if (cards == null || cards.Count != 4)
        {
            await Clients.Caller.SendAsync("24Error", "Invalid game state");
            return;
        }

        var cardNumbers = cards.Select(c => c.Number).ToArray();
        if (!TwentyFourService.ValidateSolution(cardNumbers, steps))
        {
            await Clients.Caller.SendAsync("24Error", "Invalid solution — does not equal 24 or uses wrong cards");
            return;
        }

        var (newState, scores) = await _twentyFourService.RecordWinAndDealNew(room.Id, gameState.Id, player, steps);

        await Clients.Group(code).SendAsync("24GameWon", player, stepsJson, JsonSerializer.Serialize(scores));

        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards),
            newState.HandNumber,
            JsonSerializer.Serialize(scores));
    }

    /// <summary>
    /// Request new hand (skip current)
    /// </summary>
    public async Task Request24NewHand(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "TwentyFour") return;

        var gameState = await _twentyFourService.GetGameState(room.Id);
        if (gameState == null || gameState.Status != "Playing") return;

        // Get display name of requester
        string requester = "Unknown";
        if (_connections.TryGetValue(Context.ConnectionId, out var info))
        {
            requester = info.DisplayName;
        }

        var newState = await _twentyFourService.SkipAndDealNew(room.Id, gameState.Id);
        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson);

        await Clients.Group(code).SendAsync("24HandSkipped", requester);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards),
            newState.HandNumber,
            newState.ScoresJson);
    }

    /// <summary>
    /// Cooperative mode: broadcast card/operator placement in real-time
    /// </summary>
    public async Task Place24Card(string code, string player, int row, int slot, int cardValue)
    {
        code = code.ToUpper();
        await Clients.OthersInGroup(code).SendAsync("24CardPlaced", player, row, slot, cardValue);
    }

    public async Task Place24Operator(string code, string player, int row, string op)
    {
        code = code.ToUpper();
        await Clients.OthersInGroup(code).SendAsync("24OperatorPlaced", player, row, op);
    }

    public async Task Undo24(string code, string player, int row)
    {
        code = code.ToUpper();
        await Clients.OthersInGroup(code).SendAsync("24Undo", player, row);
    }

    // Kept from original GameHub for backward compatibility
    public async Task Complete24Row(string code, string player, int row, int card1, string op, int card2, int result)
    {
        code = code.ToUpper();
        if (!TwentyFourService.ValidateStep(card1, op, card2, result))
        {
            await Clients.Caller.SendAsync("24Error", "Invalid operation result");
            return;
        }

        var (gameType, mode) = await _roomService.GetRoomInfo(code);
        if (gameType != "TwentyFour") return;

        if (mode == "Cooperative")
        {
            await Clients.Group(code).SendAsync("24RowCompleted", player, row, card1, op, card2, result);
        }
        else
        {
            await Clients.Group(code).SendAsync("24ProgressUpdated", player, row + 1);
        }
    }

    public async Task Win24Game(string code, string player, string stepsJson)
    {
        // Delegate to Submit24Solution
        await Submit24Solution(code, player, stepsJson);
    }

    public async Task Skip24Hand(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "TwentyFour") return;

        var gameState = await _twentyFourService.GetGameState(room.Id);
        if (gameState == null || gameState.Status != "Playing") return;

        var newState = await _twentyFourService.SkipAndDealNew(room.Id, gameState.Id);
        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson);

        await Clients.Group(code).SendAsync("24HandSkipped", player);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards),
            newState.HandNumber,
            newState.ScoresJson);
    }

    // ==================== Timer methods ====================

    /// <summary>
    /// Start the game timer. Sets StartedAt on the room if not already set.
    /// Broadcasts TimerStarted with the server timestamp and time limit.
    /// </summary>
    public async Task StartTimer(string code)
    {
        code = code.ToUpper();
        var startedAt = await _roomService.StartTimer(code);
        if (startedAt == null) return;

        var room = await _roomService.GetRoomByCode(code);
        await Clients.Group(code).SendAsync("TimerStarted", startedAt.Value, room?.TimeLimitSeconds);
    }

    /// <summary>
    /// Client reports that the timer has expired. Server validates and broadcasts.
    /// </summary>
    public async Task TimerExpired(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.StartedAt == null || room.TimeLimitSeconds == null) return;

        // Verify timer actually expired
        var elapsed = (DateTime.UtcNow - room.StartedAt.Value).TotalSeconds;
        if (elapsed < room.TimeLimitSeconds.Value - 2) return; // 2s grace

        await Clients.Group(code).SendAsync("TimerExpired");
    }

    // ==================== WebRTC Signaling ====================

    /// <summary>
    /// Send an SDP offer to a specific peer
    /// </summary>
    public async Task SendOffer(string code, string targetConnectionId, string sdp)
    {
        code = code.ToUpper();
        string senderName = "Unknown";
        if (_connections.TryGetValue(Context.ConnectionId, out var info))
        {
            senderName = info.DisplayName;
        }

        await Clients.Client(targetConnectionId).SendAsync("ReceiveOffer",
            Context.ConnectionId, senderName, sdp);
    }

    /// <summary>
    /// Send an SDP answer to a specific peer
    /// </summary>
    public async Task SendAnswer(string code, string targetConnectionId, string sdp)
    {
        code = code.ToUpper();
        string senderName = "Unknown";
        if (_connections.TryGetValue(Context.ConnectionId, out var info))
        {
            senderName = info.DisplayName;
        }

        await Clients.Client(targetConnectionId).SendAsync("ReceiveAnswer",
            Context.ConnectionId, senderName, sdp);
    }

    /// <summary>
    /// Send an ICE candidate to a specific peer
    /// </summary>
    public async Task SendIceCandidate(string code, string targetConnectionId, string candidate)
    {
        code = code.ToUpper();
        await Clients.Client(targetConnectionId).SendAsync("ReceiveIceCandidate",
            Context.ConnectionId, candidate);
    }

    /// <summary>
    /// Get list of all connected peers in the room (for WebRTC mesh setup)
    /// </summary>
    public async Task RequestPeerList(string code)
    {
        code = code.ToUpper();
        var peers = _connections
            .Where(kvp => kvp.Value.RoomCode == code && kvp.Key != Context.ConnectionId)
            .Select(kvp => new { connectionId = kvp.Key, displayName = kvp.Value.DisplayName })
            .ToList();

        await Clients.Caller.SendAsync("PeerList", JsonSerializer.Serialize(peers));
    }
}
