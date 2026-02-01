using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class BlackjackService
{
    private readonly string _connectionString;
    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly Random _rng = new();
    private static readonly string[] Suits = ["Hearts", "Diamonds", "Clubs", "Spades"];

    public BlackjackService(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
    }

    private SqlConnection GetConnection() => new(_connectionString);

    // Build a 6-deck shoe
    private static List<BlackjackCard> BuildShoe()
    {
        var deck = new List<BlackjackCard>();
        for (int d = 0; d < 6; d++)
            foreach (var suit in Suits)
                for (int rank = 1; rank <= 13; rank++)
                    deck.Add(new BlackjackCard { Rank = rank, Suit = suit });

        // Fisher-Yates shuffle
        for (int i = deck.Count - 1; i > 0; i--)
        {
            int j = _rng.Next(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
        return deck;
    }

    public static int HandValue(List<BlackjackCard> cards)
    {
        int total = 0, aces = 0;
        foreach (var c in cards)
        {
            if (c.Rank == 1) { total += 11; aces++; }
            else if (c.Rank >= 11) total += 10;
            else total += c.Rank;
        }
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        return total;
    }

    public static bool IsBlackjack(List<BlackjackCard> cards) =>
        cards.Count == 2 && HandValue(cards) == 21;

    public async Task<BlackjackGameState> InitializeGame(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var shoe = BuildShoe();
        var state = new BlackjackGameState
        {
            RoomId = roomId,
            DeckJson = JsonSerializer.Serialize(shoe, _jsonOpts),
            DealerHandJson = "[]",
            DealerRevealed = false,
            Phase = "Betting",
            CurrentPlayerIndex = 0,
            PlayersJson = "[]"
        };

        state.Id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO BlackjackGameStates (RoomId, DeckJson, DealerHandJson, DealerRevealed, Phase, CurrentPlayerIndex, PlayersJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @DeckJson, @DealerHandJson, @DealerRevealed, @Phase, @CurrentPlayerIndex, @PlayersJson)",
            state);

        return state;
    }

    public async Task<BlackjackGameState?> GetGameState(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });
    }

    public BlackjackStateResponse ToResponse(BlackjackGameState state, bool hideHoleCard = true)
    {
        var dealerHand = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DealerHandJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        // If dealer hole card not revealed, only show first card
        var visibleDealerHand = dealerHand;
        if (hideHoleCard && !state.DealerRevealed && dealerHand.Count >= 2)
        {
            visibleDealerHand = [dealerHand[0], new BlackjackCard { Rank = 0, Suit = "Hidden" }];
        }

        return new BlackjackStateResponse
        {
            Id = state.Id,
            RoomId = state.RoomId,
            DealerHand = visibleDealerHand,
            DealerRevealed = state.DealerRevealed,
            Phase = state.Phase,
            CurrentPlayerIndex = state.CurrentPlayerIndex,
            Players = players
        };
    }

    private async Task SaveState(BlackjackGameState state)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE BlackjackGameStates
            SET DeckJson = @DeckJson, DealerHandJson = @DealerHandJson, DealerRevealed = @DealerRevealed,
                Phase = @Phase, CurrentPlayerIndex = @CurrentPlayerIndex, PlayersJson = @PlayersJson
            WHERE Id = @Id", state);
    }

    private BlackjackCard DrawCard(List<BlackjackCard> deck)
    {
        if (deck.Count == 0) throw new InvalidOperationException("Deck is empty");
        var card = deck[0];
        deck.RemoveAt(0);
        return card;
    }

    public async Task<BlackjackGameState> EnsurePlayerInGame(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) state = await InitializeGame(roomId);

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        if (!players.Any(p => p.PlayerName == playerName))
        {
            players.Add(new BlackjackPlayer { PlayerName = playerName, Chips = 1000, Status = "Waiting" });
            state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
            await SaveState(state);
        }
        return state;
    }

    public async Task<BlackjackGameState> PlaceBet(int roomId, string playerName, int amount)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Betting") throw new InvalidOperationException("Not in betting phase");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var player = players.FirstOrDefault(p => p.PlayerName == playerName);
        if (player == null) throw new InvalidOperationException("Player not in game");
        if (amount > player.Chips || amount <= 0) throw new InvalidOperationException("Invalid bet amount");

        player.Bet = amount;
        player.Chips -= amount;
        player.Status = "Waiting";
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> DealInitialCards(int roomId)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Betting") throw new InvalidOperationException("Not in betting phase");

        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var dealerHand = new List<BlackjackCard>();

        // Deal 2 cards to each player, then 2 to dealer
        foreach (var p in players)
        {
            p.Cards = [DrawCard(deck), DrawCard(deck)];
            if (IsBlackjack(p.Cards))
                p.Status = "Blackjack";
            else
                p.Status = "Playing";
        }

        dealerHand.Add(DrawCard(deck));
        dealerHand.Add(DrawCard(deck));

        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.DealerHandJson = JsonSerializer.Serialize(dealerHand, _jsonOpts);
        state.DealerRevealed = false;
        state.CurrentPlayerIndex = 0;

        // Skip players with blackjack
        while (state.CurrentPlayerIndex < players.Count &&
               players[state.CurrentPlayerIndex].Status != "Playing")
        {
            state.CurrentPlayerIndex++;
        }

        // If all players have blackjack or no playing players, go to dealer
        if (state.CurrentPlayerIndex >= players.Count)
            state.Phase = "DealerTurn";
        else
            state.Phase = "Playing";

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> Hit(int roomId, string playerName)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Playing") throw new InvalidOperationException("Not in playing phase");

        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var player = players[state.CurrentPlayerIndex];
        if (player.PlayerName != playerName) throw new InvalidOperationException("Not your turn");

        player.Cards.Add(DrawCard(deck));
        var val = HandValue(player.Cards);

        if (val > 21)
        {
            player.Status = "Bust";
            AdvanceToNextPlayer(state, players);
        }
        else if (val == 21)
        {
            player.Status = "Standing";
            AdvanceToNextPlayer(state, players);
        }

        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> Stand(int roomId, string playerName)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Playing") throw new InvalidOperationException("Not in playing phase");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var player = players[state.CurrentPlayerIndex];
        if (player.PlayerName != playerName) throw new InvalidOperationException("Not your turn");

        player.Status = "Standing";
        AdvanceToNextPlayer(state, players);

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> DoubleDown(int roomId, string playerName)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Playing") throw new InvalidOperationException("Not in playing phase");

        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var player = players[state.CurrentPlayerIndex];
        if (player.PlayerName != playerName) throw new InvalidOperationException("Not your turn");
        if (player.Cards.Count != 2) throw new InvalidOperationException("Can only double on first 2 cards");
        if (player.Chips < player.Bet) throw new InvalidOperationException("Not enough chips to double");

        player.Chips -= player.Bet;
        player.Bet *= 2;
        player.Cards.Add(DrawCard(deck));

        if (HandValue(player.Cards) > 21)
            player.Status = "Bust";
        else
            player.Status = "Standing";

        AdvanceToNextPlayer(state, players);

        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> PlayDealer(int roomId)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");

        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        var dealerHand = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DealerHandJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        state.DealerRevealed = true;

        // Check if any players are still in (not all busted)
        bool anyActive = players.Any(p => p.Status == "Standing" || p.Status == "Blackjack");

        if (anyActive)
        {
            // Dealer hits until 17+
            while (HandValue(dealerHand) < 17)
            {
                dealerHand.Add(DrawCard(deck));
            }
        }

        int dealerVal = HandValue(dealerHand);
        bool dealerBust = dealerVal > 21;
        bool dealerBJ = IsBlackjack(dealerHand);

        // Resolve each player
        foreach (var p in players)
        {
            if (p.Status == "Bust")
            {
                p.Status = "Lost";
                continue;
            }

            int playerVal = HandValue(p.Cards);
            bool playerBJ = p.Status == "Blackjack";

            if (playerBJ && dealerBJ)
            {
                p.Status = "Push";
                p.Chips += p.Bet; // Return bet
            }
            else if (playerBJ)
            {
                p.Status = "Blackjack";
                p.Chips += p.Bet + (int)(p.Bet * 1.5); // 3:2 payout
            }
            else if (dealerBust)
            {
                p.Status = "Won";
                p.Chips += p.Bet * 2; // 1:1
            }
            else if (playerVal > dealerVal)
            {
                p.Status = "Won";
                p.Chips += p.Bet * 2;
            }
            else if (playerVal == dealerVal)
            {
                p.Status = "Push";
                p.Chips += p.Bet;
            }
            else
            {
                p.Status = "Lost";
            }
        }

        state.Phase = "Payout";
        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.DealerHandJson = JsonSerializer.Serialize(dealerHand, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    public async Task<BlackjackGameState> NewRound(int roomId)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        // Reshuffle if deck is getting low (< 78 cards = 25% of shoe)
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        if (deck.Count < 78)
            deck = BuildShoe();

        // Reset players for new round
        foreach (var p in players)
        {
            p.Cards = [];
            p.Bet = 0;
            p.Status = "Waiting";
            p.InsuranceBet = 0;
            // Remove busted-out players (0 chips)
        }
        players = players.Where(p => p.Chips > 0).ToList();

        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.DealerHandJson = "[]";
        state.DealerRevealed = false;
        state.Phase = "Betting";
        state.CurrentPlayerIndex = 0;
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    /// <summary>
    /// Convert DB state to a JSON string suitable for broadcasting, hiding dealer hole card when appropriate.
    /// </summary>
    public static string SanitizeState(BlackjackGameState state)
    {
        var dealerHand = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DealerHandJson, _jsonOpts) ?? [];
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        // Hide dealer hole card during play
        var visibleDealerHand = dealerHand;
        if (!state.DealerRevealed && dealerHand.Count >= 2)
        {
            visibleDealerHand = [dealerHand[0], new BlackjackCard { Rank = 0, Suit = "Hidden" }];
        }

        var response = new BlackjackStateResponse
        {
            Id = state.Id,
            RoomId = state.RoomId,
            DealerHand = visibleDealerHand,
            DealerRevealed = state.DealerRevealed,
            Phase = state.Phase,
            CurrentPlayerIndex = state.CurrentPlayerIndex,
            Players = players
        };

        return JsonSerializer.Serialize(response, _jsonOpts);
    }

    private void AdvanceToNextPlayer(BlackjackGameState state, List<BlackjackPlayer> players)
    {
        state.CurrentPlayerIndex++;
        while (state.CurrentPlayerIndex < players.Count &&
               players[state.CurrentPlayerIndex].Status != "Playing")
        {
            state.CurrentPlayerIndex++;
        }

        if (state.CurrentPlayerIndex >= players.Count)
        {
            state.Phase = "DealerTurn";
        }
    }
}
