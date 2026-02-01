using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class BlackjackService
{
    private readonly string _connectionString;
    private static readonly Random _rng = new();
    private static readonly string[] Suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public BlackjackService(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
    }

    private SqlConnection GetConnection() => new(_connectionString);

    /// <summary>
    /// Generate a shuffled shoe of 6 standard decks (312 cards).
    /// </summary>
    private static List<BlackjackCard> GenerateShoe()
    {
        var shoe = new List<BlackjackCard>();
        for (int d = 0; d < 6; d++)
        {
            foreach (var suit in Suits)
            {
                for (int rank = 1; rank <= 13; rank++)
                {
                    shoe.Add(new BlackjackCard { Rank = rank, Suit = suit });
                }
            }
        }
        // Fisher-Yates shuffle
        for (int i = shoe.Count - 1; i > 0; i--)
        {
            int j = _rng.Next(i + 1);
            (shoe[i], shoe[j]) = (shoe[j], shoe[i]);
        }
        return shoe;
    }

    /// <summary>
    /// Calculate the best hand value for a set of cards.
    /// Aces count as 11 unless that would bust, then they count as 1.
    /// </summary>
    public static int CalculateHandValue(List<BlackjackCard> cards)
    {
        int value = 0;
        int aces = 0;
        foreach (var card in cards)
        {
            if (card.Rank == 1)
            {
                aces++;
                value += 11;
            }
            else if (card.Rank >= 10) // 10, J, Q, K
            {
                value += 10;
            }
            else
            {
                value += card.Rank;
            }
        }
        // Downgrade aces from 11 to 1 as needed
        while (value > 21 && aces > 0)
        {
            value -= 10;
            aces--;
        }
        return value;
    }

    /// <summary>
    /// Check if a hand is a natural blackjack (exactly 2 cards totaling 21).
    /// </summary>
    private static bool IsBlackjack(List<BlackjackCard> cards)
    {
        return cards.Count == 2 && CalculateHandValue(cards) == 21;
    }

    /// <summary>
    /// Initialize a new blackjack game state for a room.
    /// </summary>
    public async Task<BlackjackGameState> InitializeGame(int roomId)
    {
        var shoe = GenerateShoe();

        using var conn = GetConnection();
        await conn.OpenAsync();

        var id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO BlackjackGameStates (RoomId, DeckJson, DealerHandJson, DealerRevealed, Phase, CurrentPlayerIndex, PlayersJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @DeckJson, '[]', 0, 'Betting', 0, '[]')",
            new
            {
                RoomId = roomId,
                DeckJson = JsonSerializer.Serialize(shoe, _jsonOpts)
            });

        return new BlackjackGameState
        {
            Id = id,
            RoomId = roomId,
            DeckJson = JsonSerializer.Serialize(shoe, _jsonOpts),
            DealerHandJson = "[]",
            DealerRevealed = false,
            Phase = "Betting",
            CurrentPlayerIndex = 0,
            PlayersJson = "[]"
        };
    }

    /// <summary>
    /// Get the current (most recent) game state for a room.
    /// </summary>
    public async Task<BlackjackGameState?> GetGameState(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });
    }

    /// <summary>
    /// Place a bet for a player. Adds the player if not already present.
    /// </summary>
    public async Task<BlackjackGameState> PlaceBet(int roomId, string playerName, int amount)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "Betting")
            throw new InvalidOperationException("Bets can only be placed during the Betting phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        var player = players.FirstOrDefault(p => p.PlayerName == playerName);
        if (player == null)
        {
            player = new BlackjackPlayer { PlayerName = playerName, Chips = 1000 };
            players.Add(player);
        }

        if (amount <= 0 || amount > player.Chips)
            throw new InvalidOperationException("Invalid bet amount.");

        player.Bet = amount;
        player.Chips -= amount;
        player.Status = "Waiting";
        player.Cards = [];

        await conn.ExecuteAsync(@"
            UPDATE BlackjackGameStates SET PlayersJson = @PlayersJson WHERE Id = @Id",
            new { PlayersJson = JsonSerializer.Serialize(players, _jsonOpts), state.Id });

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        return state;
    }

    /// <summary>
    /// Deal initial cards (2 to each player, 2 to dealer). Transitions to Playing phase.
    /// </summary>
    public async Task<BlackjackGameState> DealInitialCards(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "Betting")
            throw new InvalidOperationException("Cards can only be dealt from the Betting phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        if (players.Count == 0 || players.All(p => p.Bet <= 0))
            throw new InvalidOperationException("At least one player must have placed a bet.");

        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];

        // Reshuffle if running low
        if (deck.Count < (players.Count + 1) * 10)
        {
            deck = GenerateShoe();
        }

        var dealerHand = new List<BlackjackCard>();

        // Deal 2 cards to each player, then 2 to dealer
        for (int round = 0; round < 2; round++)
        {
            foreach (var player in players)
            {
                if (player.Bet > 0)
                {
                    player.Cards.Add(deck[0]);
                    deck.RemoveAt(0);
                }
            }
            dealerHand.Add(deck[0]);
            deck.RemoveAt(0);
        }

        // Check for player blackjacks
        foreach (var player in players)
        {
            if (player.Bet > 0 && IsBlackjack(player.Cards))
            {
                player.Status = "Blackjack";
            }
            else if (player.Bet > 0)
            {
                player.Status = "Playing";
            }
        }

        // Find the first active (Playing) player
        int currentIndex = players.FindIndex(p => p.Status == "Playing");
        string phase = currentIndex >= 0 ? "Playing" : "DealerTurn";

        await conn.ExecuteAsync(@"
            UPDATE BlackjackGameStates 
            SET DeckJson = @DeckJson, DealerHandJson = @DealerHandJson, DealerRevealed = 0,
                Phase = @Phase, CurrentPlayerIndex = @CurrentPlayerIndex, PlayersJson = @PlayersJson
            WHERE Id = @Id",
            new
            {
                DeckJson = JsonSerializer.Serialize(deck, _jsonOpts),
                DealerHandJson = JsonSerializer.Serialize(dealerHand, _jsonOpts),
                Phase = phase,
                CurrentPlayerIndex = Math.Max(currentIndex, 0),
                PlayersJson = JsonSerializer.Serialize(players, _jsonOpts),
                state.Id
            });

        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.DealerHandJson = JsonSerializer.Serialize(dealerHand, _jsonOpts);
        state.DealerRevealed = false;
        state.Phase = phase;
        state.CurrentPlayerIndex = Math.Max(currentIndex, 0);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        return state;
    }

    /// <summary>
    /// Player hits — draw one card. Check for bust.
    /// </summary>
    public async Task<BlackjackGameState> Hit(int roomId, string playerName)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "Playing")
            throw new InvalidOperationException("Can only hit during Playing phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];

        var player = players.FirstOrDefault(p => p.PlayerName == playerName);
        if (player == null || player.Status != "Playing")
            throw new InvalidOperationException("It's not this player's turn or player not found.");

        // Verify it's their turn
        if (players.IndexOf(player) != state.CurrentPlayerIndex)
            throw new InvalidOperationException("It's not this player's turn.");

        // Draw a card
        player.Cards.Add(deck[0]);
        deck.RemoveAt(0);

        var handValue = CalculateHandValue(player.Cards);
        if (handValue > 21)
        {
            player.Status = "Bust";
            // Advance to next player
            AdvanceToNextPlayer(players, state);
        }
        else if (handValue == 21)
        {
            player.Status = "Standing";
            AdvanceToNextPlayer(players, state);
        }

        await SaveState(conn, state, deck, players);
        return state;
    }

    /// <summary>
    /// Player stands — advance to next player or dealer.
    /// </summary>
    public async Task<BlackjackGameState> Stand(int roomId, string playerName)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "Playing")
            throw new InvalidOperationException("Can only stand during Playing phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];

        var player = players.FirstOrDefault(p => p.PlayerName == playerName);
        if (player == null || player.Status != "Playing")
            throw new InvalidOperationException("Player not found or not active.");

        if (players.IndexOf(player) != state.CurrentPlayerIndex)
            throw new InvalidOperationException("It's not this player's turn.");

        player.Status = "Standing";
        AdvanceToNextPlayer(players, state);

        await SaveState(conn, state, deck, players);
        return state;
    }

    /// <summary>
    /// Player doubles down — double bet, draw exactly 1 card, then stand.
    /// </summary>
    public async Task<BlackjackGameState> DoubleDown(int roomId, string playerName)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "Playing")
            throw new InvalidOperationException("Can only double down during Playing phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];

        var player = players.FirstOrDefault(p => p.PlayerName == playerName);
        if (player == null || player.Status != "Playing")
            throw new InvalidOperationException("Player not found or not active.");

        if (players.IndexOf(player) != state.CurrentPlayerIndex)
            throw new InvalidOperationException("It's not this player's turn.");

        if (player.Cards.Count != 2)
            throw new InvalidOperationException("Can only double down on initial two cards.");

        if (player.Chips < player.Bet)
            throw new InvalidOperationException("Not enough chips to double down.");

        // Double the bet
        player.Chips -= player.Bet;
        player.Bet *= 2;

        // Draw exactly 1 card
        player.Cards.Add(deck[0]);
        deck.RemoveAt(0);

        var handValue = CalculateHandValue(player.Cards);
        player.Status = handValue > 21 ? "Bust" : "Standing";

        AdvanceToNextPlayer(players, state);

        await SaveState(conn, state, deck, players);
        return state;
    }

    /// <summary>
    /// Play the dealer's hand. Dealer hits on soft 17 (<=16), stands on 17+.
    /// Then resolve all hands and pay out.
    /// </summary>
    public async Task<BlackjackGameState> PlayDealer(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state.Phase != "DealerTurn")
            throw new InvalidOperationException("Not in DealerTurn phase.");

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];
        var dealerHand = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DealerHandJson, _jsonOpts) ?? [];

        // Check if any players are still standing (non-bust, non-blackjack-already-paid)
        bool anyActive = players.Any(p => p.Status == "Standing" || p.Status == "Blackjack");

        if (anyActive)
        {
            // Dealer draws until 17+
            while (CalculateHandValue(dealerHand) < 17)
            {
                dealerHand.Add(deck[0]);
                deck.RemoveAt(0);
            }
        }

        int dealerValue = CalculateHandValue(dealerHand);
        bool dealerBust = dealerValue > 21;
        bool dealerBlackjack = IsBlackjack(dealerHand);

        // Resolve each player's hand
        foreach (var player in players)
        {
            if (player.Bet <= 0) continue;

            if (player.Status == "Bust")
            {
                // Already lost their bet
                player.Status = "Lost";
                continue;
            }

            int playerValue = CalculateHandValue(player.Cards);
            bool playerBJ = player.Status == "Blackjack";

            if (playerBJ && dealerBlackjack)
            {
                // Both have blackjack — push
                player.Status = "Push";
                player.Chips += player.Bet; // return bet
            }
            else if (playerBJ)
            {
                // Player blackjack pays 3:2
                player.Status = "Blackjack";
                int payout = player.Bet + (int)Math.Ceiling(player.Bet * 1.5);
                player.Chips += payout;
            }
            else if (dealerBlackjack)
            {
                // Dealer blackjack, player loses
                player.Status = "Lost";
            }
            else if (dealerBust)
            {
                // Dealer busts, player wins 1:1
                player.Status = "Won";
                player.Chips += player.Bet * 2;
            }
            else if (playerValue > dealerValue)
            {
                player.Status = "Won";
                player.Chips += player.Bet * 2;
            }
            else if (playerValue == dealerValue)
            {
                player.Status = "Push";
                player.Chips += player.Bet; // return bet
            }
            else
            {
                player.Status = "Lost";
            }
        }

        state.Phase = "Payout";
        state.DealerRevealed = true;
        state.DealerHandJson = JsonSerializer.Serialize(dealerHand, _jsonOpts);
        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);

        await conn.ExecuteAsync(@"
            UPDATE BlackjackGameStates 
            SET DeckJson = @DeckJson, DealerHandJson = @DealerHandJson, DealerRevealed = 1,
                Phase = 'Payout', PlayersJson = @PlayersJson
            WHERE Id = @Id",
            new
            {
                DeckJson = state.DeckJson,
                DealerHandJson = state.DealerHandJson,
                PlayersJson = state.PlayersJson,
                state.Id
            });

        return state;
    }

    /// <summary>
    /// Start a new round — reset cards/bets but keep chips and players.
    /// </summary>
    public async Task<BlackjackGameState> NewRound(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var deck = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DeckJson, _jsonOpts) ?? [];

        // Reshuffle if running low
        if (deck.Count < 60)
        {
            deck = GenerateShoe();
        }

        // Reset each player for new round (keep chips)
        foreach (var player in players)
        {
            player.Cards = [];
            player.Bet = 0;
            player.Status = "Waiting";
            player.InsuranceBet = 0;
        }

        // Remove players with 0 chips (they're broke)
        // Actually keep them so they can see, but they can't bet

        var newId = await conn.QuerySingleAsync<int>(@"
            INSERT INTO BlackjackGameStates (RoomId, DeckJson, DealerHandJson, DealerRevealed, Phase, CurrentPlayerIndex, PlayersJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @DeckJson, '[]', 0, 'Betting', 0, @PlayersJson)",
            new
            {
                RoomId = roomId,
                DeckJson = JsonSerializer.Serialize(deck, _jsonOpts),
                PlayersJson = JsonSerializer.Serialize(players, _jsonOpts)
            });

        return new BlackjackGameState
        {
            Id = newId,
            RoomId = roomId,
            DeckJson = JsonSerializer.Serialize(deck, _jsonOpts),
            DealerHandJson = "[]",
            DealerRevealed = false,
            Phase = "Betting",
            CurrentPlayerIndex = 0,
            PlayersJson = JsonSerializer.Serialize(players, _jsonOpts)
        };
    }

    /// <summary>
    /// Ensure a player exists in the game state (called on join).
    /// </summary>
    public async Task<BlackjackGameState> EnsurePlayer(int roomId, string playerName)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleOrDefaultAsync<BlackjackGameState>(
            "SELECT TOP 1 * FROM BlackjackGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });

        if (state == null)
        {
            state = await InitializeGame(roomId);
        }

        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        if (players.All(p => p.PlayerName != playerName))
        {
            players.Add(new BlackjackPlayer { PlayerName = playerName, Chips = 1000 });
            await conn.ExecuteAsync(
                "UPDATE BlackjackGameStates SET PlayersJson = @PlayersJson WHERE Id = @Id",
                new { PlayersJson = JsonSerializer.Serialize(players, _jsonOpts), state.Id });
            state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        }

        return state;
    }

    /// <summary>
    /// Create a sanitized copy of the state — hides dealer's hole card when not revealed.
    /// </summary>
    public static string SanitizeState(BlackjackGameState state)
    {
        var players = JsonSerializer.Deserialize<List<BlackjackPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var dealerHand = JsonSerializer.Deserialize<List<BlackjackCard>>(state.DealerHandJson, _jsonOpts) ?? [];

        List<BlackjackCard?> visibleDealerHand;
        int dealerVisibleValue;

        if (state.DealerRevealed || state.Phase == "Payout")
        {
            visibleDealerHand = dealerHand.Cast<BlackjackCard?>().ToList();
            dealerVisibleValue = CalculateHandValue(dealerHand);
        }
        else if (dealerHand.Count >= 2)
        {
            // Show only the first card, second is hidden
            visibleDealerHand = [dealerHand[0], null];
            dealerVisibleValue = CalculateHandValue([dealerHand[0]]);
        }
        else
        {
            visibleDealerHand = dealerHand.Cast<BlackjackCard?>().ToList();
            dealerVisibleValue = CalculateHandValue(dealerHand);
        }

        var sanitized = new
        {
            id = state.Id,
            roomId = state.RoomId,
            dealerHand = visibleDealerHand,
            dealerValue = dealerVisibleValue,
            dealerRevealed = state.DealerRevealed,
            phase = state.Phase,
            currentPlayerIndex = state.CurrentPlayerIndex,
            players = players.Select(p => new
            {
                playerName = p.PlayerName,
                cards = p.Cards,
                handValue = CalculateHandValue(p.Cards),
                bet = p.Bet,
                chips = p.Chips,
                status = p.Status,
                insuranceBet = p.InsuranceBet
            })
        };

        return JsonSerializer.Serialize(sanitized, _jsonOpts);
    }

    // ===== Private helpers =====

    /// <summary>
    /// Advance to the next active player, or transition to DealerTurn if none left.
    /// </summary>
    private void AdvanceToNextPlayer(List<BlackjackPlayer> players, BlackjackGameState state)
    {
        int nextIndex = state.CurrentPlayerIndex + 1;
        while (nextIndex < players.Count)
        {
            if (players[nextIndex].Status == "Playing")
            {
                state.CurrentPlayerIndex = nextIndex;
                state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
                return;
            }
            nextIndex++;
        }
        // No more active players — dealer's turn
        state.Phase = "DealerTurn";
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
    }

    private async Task SaveState(SqlConnection conn, BlackjackGameState state, List<BlackjackCard> deck, List<BlackjackPlayer> players)
    {
        state.DeckJson = JsonSerializer.Serialize(deck, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);

        await conn.ExecuteAsync(@"
            UPDATE BlackjackGameStates 
            SET DeckJson = @DeckJson, DealerHandJson = @DealerHandJson, DealerRevealed = @DealerRevealed,
                Phase = @Phase, CurrentPlayerIndex = @CurrentPlayerIndex, PlayersJson = @PlayersJson
            WHERE Id = @Id",
            new
            {
                DeckJson = state.DeckJson,
                DealerHandJson = state.DealerHandJson,
                DealerRevealed = state.DealerRevealed,
                Phase = state.Phase,
                CurrentPlayerIndex = state.CurrentPlayerIndex,
                PlayersJson = state.PlayersJson,
                state.Id
            });
    }
}
