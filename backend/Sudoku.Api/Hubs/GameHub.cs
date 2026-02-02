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
    private readonly BlackjackService _blackjackService;
    private readonly ChessService _chessService;
    private readonly GuandanService _guandanService;

    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    // Track connection → (roomCode, displayName) for peer list
    private static readonly ConcurrentDictionary<string, (string RoomCode, string DisplayName)> _connections = new();

    // Track rooms where host has left: roomCode → (hostName, leftAt)
    private static readonly ConcurrentDictionary<string, (string HostName, DateTime LeftAt)> _hostLeftTimers = new();

    public GameHub(RoomService roomService, TwentyFourService twentyFourService, BlackjackService blackjackService, ChessService chessService, GuandanService guandanService)
    {
        _roomService = roomService;
        _twentyFourService = twentyFourService;
        _blackjackService = blackjackService;
        _chessService = chessService;
        _guandanService = guandanService;
    }

    /// <summary>Get all room codes that have at least one connected player.</summary>
    public static HashSet<string> GetActiveRoomCodes()
    {
        return _connections.Values.Select(v => v.RoomCode).ToHashSet();
    }

    /// <summary>Get host-left timers for cleanup service.</summary>
    public static ConcurrentDictionary<string, (string HostName, DateTime LeftAt)> GetHostLeftTimers() => _hostLeftTimers;

    /// <summary>Get connected player count for a room.</summary>
    public static int GetConnectedCount(string roomCode)
    {
        return _connections.Values.Count(v => v.RoomCode == roomCode);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_connections.TryRemove(Context.ConnectionId, out var info))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, info.RoomCode);
            await Clients.Group(info.RoomCode).SendAsync("PlayerLeft", info.DisplayName);
            await Clients.Group(info.RoomCode).SendAsync("PeerLeft", Context.ConnectionId, info.DisplayName);

            // Check if this was the host leaving
            var room = await _roomService.GetRoomByCode(info.RoomCode);
            if (room != null && room.HostName == info.DisplayName && room.Status == "Active")
            {
                var othersInRoom = GetConnectedCount(info.RoomCode);
                if (othersInRoom == 0)
                {
                    // Host left, nobody else — start the auto-close timer
                    _hostLeftTimers[info.RoomCode] = (info.DisplayName, DateTime.UtcNow);
                }
                else
                {
                    // Host left but others remain — still start timer but with longer grace
                    _hostLeftTimers[info.RoomCode] = (info.DisplayName, DateTime.UtcNow);
                }
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    // ==================== Room methods ====================

    public async Task JoinRoom(string code, string displayName)
    {
        code = code.ToUpper();
        _connections[Context.ConnectionId] = (code, displayName);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);

        // Cancel auto-close timer if host rejoins or anyone joins an empty room
        if (_hostLeftTimers.TryGetValue(code, out var timer))
        {
            if (timer.HostName == displayName || GetConnectedCount(code) >= 1)
            {
                _hostLeftTimers.TryRemove(code, out _);
            }
        }

        // Auto-add player to Blackjack game state on join
        try
        {
            var room = await _roomService.GetRoomByCode(code);
            if (room?.GameType == "Blackjack")
            {
                var state = await _blackjackService.EnsurePlayerInGame(room.Id, displayName);
                await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
            }
            if (room?.GameType == "Guandan")
            {
                var state = await _guandanService.EnsurePlayerInGame(room.Id, displayName);
                // Send personalized state to each connection
                await BroadcastGuandanState(code, state);
            }
        }
        catch { /* non-critical — player can still be added on first bet */ }

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

    /// <summary>Host force-closes the room.</summary>
    public async Task CloseRoom(string code, string hostName)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.HostName != hostName) return;

        await _roomService.CloseRoom(code);
        _hostLeftTimers.TryRemove(code, out _);
        await Clients.Group(code).SendAsync("RoomClosed", "Host closed the room");
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

        var cards = JsonSerializer.Deserialize<List<TwentyFourCard>>(gameState.CardsJson, _jsonOpts);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(cards, _jsonOpts),
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
            "-" => card1 - card2 >= 0 ? card1 - card2 : null,
            "*" => card1 * card2,
            "/" when card2 != 0 && card1 % card2 == 0 => card1 / card2,
            _ => null
        };

        if (computedResult == null)
        {
            await Clients.Caller.SendAsync("24Error", "Invalid operation — result must be a non-negative integer");
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

        var steps = JsonSerializer.Deserialize<List<TwentyFourStep>>(stepsJson, _jsonOpts);
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

        var cards = JsonSerializer.Deserialize<List<TwentyFourCard>>(gameState.CardsJson, _jsonOpts);
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

        await Clients.Group(code).SendAsync("24GameWon", player, stepsJson, JsonSerializer.Serialize(scores, _jsonOpts));

        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson, _jsonOpts);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards, _jsonOpts),
            newState.HandNumber,
            JsonSerializer.Serialize(scores, _jsonOpts));
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
        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson, _jsonOpts);

        await Clients.Group(code).SendAsync("24HandSkipped", requester);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards, _jsonOpts),
            newState.HandNumber,
            newState.ScoresJson);
    }

    /// <summary>
    /// Cooperative mode: broadcast card/operator placement in real-time
    /// </summary>
    public async Task Place24Card(string code, string player, int row, int slot, int cardValue, string sourceKey)
    {
        code = code.ToUpper();
        await Clients.OthersInGroup(code).SendAsync("24CardPlaced", player, row, slot, cardValue, sourceKey);
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

    /// <summary>
    /// Clear a single slot in cooperative mode (individual undo)
    /// </summary>
    public async Task Clear24Slot(string code, string player, int row, string slot, string sourceKey)
    {
        code = code.ToUpper();
        await Clients.OthersInGroup(code).SendAsync("24SlotCleared", player, row, slot, sourceKey);
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
        var newCards = JsonSerializer.Deserialize<List<TwentyFourCard>>(newState.CardsJson, _jsonOpts);

        await Clients.Group(code).SendAsync("24HandSkipped", player);
        await Clients.Group(code).SendAsync("24NewHand",
            JsonSerializer.Serialize(newCards, _jsonOpts),
            newState.HandNumber,
            newState.ScoresJson);
    }

    // ==================== Blackjack methods ====================

    public async Task BJPlaceBet(string code, string player, int amount)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.PlaceBet(room.Id, player, amount);
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
    }

    public async Task BJHit(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.Hit(room.Id, player);
            // If phase transitioned to DealerTurn, auto-play dealer
            if (state.Phase == "DealerTurn")
            {
                state = await _blackjackService.PlayDealer(room.Id);
            }
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
    }

    public async Task BJStand(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.Stand(room.Id, player);
            if (state.Phase == "DealerTurn")
            {
                state = await _blackjackService.PlayDealer(room.Id);
            }
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
    }

    public async Task BJDoubleDown(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.DoubleDown(room.Id, player);
            if (state.Phase == "DealerTurn")
            {
                state = await _blackjackService.PlayDealer(room.Id);
            }
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
    }

    public async Task BJDealCards(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.DealInitialCards(room.Id);
            // If all players got blackjack, auto-play dealer
            if (state.Phase == "DealerTurn")
            {
                state = await _blackjackService.PlayDealer(room.Id);
            }
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
    }

    public async Task BJNewRound(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Blackjack") return;

        try
        {
            var state = await _blackjackService.NewRound(room.Id);
            await Clients.Group(code).SendAsync("BJStateUpdated", BlackjackService.SanitizeState(state));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("BJError", ex.Message);
        }
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

        await Clients.Caller.SendAsync("PeerList", JsonSerializer.Serialize(peers, _jsonOpts));
    }

    // ==================== Chess methods ====================

    public async Task ChessMakeMove(string code, string player, string from, string to, string? promotion)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Chess") return;

        var (state, error) = await _chessService.MakeMove(room.Id, player, from, to, promotion);
        if (error != null)
        {
            await Clients.Caller.SendAsync("ChessError", error);
            return;
        }

        await Clients.Group(code).SendAsync("ChessStateUpdated", ChessService.SerializeState(state, _chessService));
    }

    public async Task ChessResign(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Chess") return;

        try
        {
            var state = await _chessService.Resign(room.Id, player);
            await Clients.Group(code).SendAsync("ChessStateUpdated", ChessService.SerializeState(state, _chessService));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("ChessError", ex.Message);
        }
    }

    public async Task ChessOfferDraw(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Chess") return;

        try
        {
            var state = await _chessService.OfferDraw(room.Id, player);
            await Clients.Group(code).SendAsync("ChessStateUpdated", ChessService.SerializeState(state, _chessService));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("ChessError", ex.Message);
        }
    }

    public async Task ChessAcceptDraw(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Chess") return;

        try
        {
            var state = await _chessService.AcceptDraw(room.Id, player);
            await Clients.Group(code).SendAsync("ChessStateUpdated", ChessService.SerializeState(state, _chessService));
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("ChessError", ex.Message);
        }
    }

    // ==================== Guandan methods ====================

    private async Task BroadcastGuandanState(string code, Models.GuandanGameState state)
    {
        // Send personalized state to each connected player in the room
        var roomConnections = _connections.Where(kvp => kvp.Value.RoomCode == code).ToList();
        foreach (var conn in roomConnections)
        {
            var personalizedState = GuandanService.SanitizeStateForPlayer(state, conn.Value.DisplayName);
            await Clients.Client(conn.Key).SendAsync("GDStateUpdated", personalizedState);
        }
    }

    public async Task GuandanStartRound(string code)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Guandan") return;

        try
        {
            var state = await _guandanService.StartRound(room.Id);
            await BroadcastGuandanState(code, state);
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("GDError", ex.Message);
        }
    }

    public async Task GuandanPlayCards(string code, string player, string cardsJson)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Guandan") return;

        try
        {
            var cards = JsonSerializer.Deserialize<List<Models.GuandanCard>>(cardsJson, _jsonOpts);
            if (cards == null || cards.Count == 0)
            {
                await Clients.Caller.SendAsync("GDError", "No cards selected");
                return;
            }

            var (state, error) = await _guandanService.PlayCards(room.Id, player, cards);
            if (error != null)
            {
                await Clients.Caller.SendAsync("GDError", error);
                return;
            }
            await BroadcastGuandanState(code, state);
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("GDError", ex.Message);
        }
    }

    public async Task GuandanPass(string code, string player)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Guandan") return;

        try
        {
            var (state, error) = await _guandanService.Pass(room.Id, player);
            if (error != null)
            {
                await Clients.Caller.SendAsync("GDError", error);
                return;
            }
            await BroadcastGuandanState(code, state);
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("GDError", ex.Message);
        }
    }

    public async Task GuandanPayTribute(string code, string player, string cardJson)
    {
        code = code.ToUpper();
        var room = await _roomService.GetRoomByCode(code);
        if (room == null || room.GameType != "Guandan") return;

        try
        {
            var card = JsonSerializer.Deserialize<Models.GuandanCard>(cardJson, _jsonOpts);
            if (card == null)
            {
                await Clients.Caller.SendAsync("GDError", "Invalid card");
                return;
            }

            var (state, error) = await _guandanService.PayTribute(room.Id, player, card);
            if (error != null)
            {
                await Clients.Caller.SendAsync("GDError", error);
                return;
            }
            await BroadcastGuandanState(code, state);
        }
        catch (InvalidOperationException ex)
        {
            await Clients.Caller.SendAsync("GDError", ex.Message);
        }
    }
}
