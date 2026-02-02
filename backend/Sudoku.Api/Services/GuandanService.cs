using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class GuandanService
{
    private readonly string _connectionString;
    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly Random _rng = new();

    // Rank order: 2=2, 3=3, ..., 10=10, J=11, Q=12, K=13, A=14, BlackJoker=16, RedJoker=17
    // Level cards get rank 15 (above A, below jokers)
    private static readonly string[] Suits = ["Hearts", "Diamonds", "Clubs", "Spades"];

    public GuandanService(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
    }

    private SqlConnection GetConnection() => new(_connectionString);

    /// <summary>Build a 108-card deck (2 standard decks + 4 jokers) and shuffle.</summary>
    private static List<GuandanCard> BuildDeck()
    {
        var deck = new List<GuandanCard>();
        for (int d = 0; d < 2; d++)
        {
            foreach (var suit in Suits)
            {
                for (int rank = 2; rank <= 14; rank++) // 2-10, J=11, Q=12, K=13, A=14
                {
                    deck.Add(new GuandanCard { Rank = rank, Suit = suit });
                }
            }
            // Add jokers per deck
            deck.Add(new GuandanCard { Rank = 16, Suit = "Black" }); // Black Joker
            deck.Add(new GuandanCard { Rank = 17, Suit = "Red" });   // Red Joker
        }

        // Fisher-Yates shuffle
        for (int i = deck.Count - 1; i > 0; i--)
        {
            int j = _rng.Next(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
        return deck;
    }

    /// <summary>Get the effective rank of a card given the current level.</summary>
    public static int GetEffectiveRank(GuandanCard card, int levelRank)
    {
        if (card.Rank == 16 || card.Rank == 17) return card.Rank; // Jokers
        if (card.Rank == levelRank) return 15; // Level cards rank above A
        return card.Rank;
    }

    /// <summary>Check if a card is a wild card (heart of the current level rank).</summary>
    public static bool IsWild(GuandanCard card, int levelRank)
    {
        return card.Rank == levelRank && card.Suit == "Hearts";
    }

    /// <summary>Convert a level (2-14) to display string.</summary>
    public static string LevelToString(int level)
    {
        return level switch
        {
            11 => "J",
            12 => "Q",
            13 => "K",
            14 => "A",
            _ => level.ToString()
        };
    }

    /// <summary>Convert a display string to level rank.</summary>
    public static int StringToLevel(string s)
    {
        return s.ToUpper() switch
        {
            "J" => 11,
            "Q" => 12,
            "K" => 13,
            "A" => 14,
            _ => int.TryParse(s, out var v) ? v : 2
        };
    }

    public async Task<GuandanGameState> InitializeGame(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = new GuandanGameState
        {
            RoomId = roomId,
            PlayersJson = "[]",
            CurrentPlayJson = "[]",
            CurrentPlayType = "",
            CurrentPlayerIndex = 0,
            LastPlayerIndex = -1,
            ConsecutivePasses = 0,
            Phase = "Waiting", // Waiting, Playing, RoundEnd, TributePhase, GameOver
            TeamALevel = 2,
            TeamBLevel = 2,
            RoundNumber = 0,
            FinishOrderJson = "[]",
            TributeStateJson = "{}",
            DealerIndex = 0
        };

        state.Id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO GuandanGameStates (RoomId, PlayersJson, CurrentPlayJson, CurrentPlayType, CurrentPlayerIndex,
                LastPlayerIndex, ConsecutivePasses, Phase, TeamALevel, TeamBLevel, RoundNumber, FinishOrderJson, TributeStateJson, DealerIndex)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @PlayersJson, @CurrentPlayJson, @CurrentPlayType, @CurrentPlayerIndex,
                @LastPlayerIndex, @ConsecutivePasses, @Phase, @TeamALevel, @TeamBLevel, @RoundNumber, @FinishOrderJson, @TributeStateJson, @DealerIndex)",
            state);

        return state;
    }

    public async Task<GuandanGameState?> GetGameState(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<GuandanGameState>(
            "SELECT TOP 1 * FROM GuandanGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });
    }

    private async Task SaveState(GuandanGameState state)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE GuandanGameStates
            SET PlayersJson = @PlayersJson, CurrentPlayJson = @CurrentPlayJson, CurrentPlayType = @CurrentPlayType,
                CurrentPlayerIndex = @CurrentPlayerIndex, LastPlayerIndex = @LastPlayerIndex,
                ConsecutivePasses = @ConsecutivePasses, Phase = @Phase, TeamALevel = @TeamALevel, TeamBLevel = @TeamBLevel,
                RoundNumber = @RoundNumber, FinishOrderJson = @FinishOrderJson, TributeStateJson = @TributeStateJson,
                DealerIndex = @DealerIndex
            WHERE Id = @Id", state);
    }

    public async Task<GuandanGameState> EnsurePlayerInGame(int roomId, string playerName)
    {
        var state = await GetGameState(roomId);
        if (state == null) state = await InitializeGame(roomId);

        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        if (!players.Any(p => p.Name == playerName) && players.Count < 4)
        {
            var seatIndex = players.Count;
            // Teams: seats 0,2 = Team A, seats 1,3 = Team B (opposite seats are partners)
            var team = (seatIndex % 2 == 0) ? "A" : "B";
            players.Add(new GuandanPlayer
            {
                Name = playerName,
                Hand = [],
                Team = team,
                SeatIndex = seatIndex,
                CardsRemaining = 0,
                IsFinished = false,
                FinishOrder = 0
            });
            state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
            await SaveState(state);
        }
        return state;
    }

    /// <summary>Start a new round: shuffle and deal 27 cards each.</summary>
    public async Task<GuandanGameState> StartRound(int roomId)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        if (players.Count != 4) throw new InvalidOperationException("Need exactly 4 players");

        state.RoundNumber++;
        var deck = BuildDeck();

        // Deal 27 cards each
        for (int i = 0; i < 4; i++)
        {
            players[i].Hand = deck.Skip(i * 27).Take(27).ToList();
            players[i].Hand.Sort((a, b) =>
            {
                var aRank = GetEffectiveRank(a, GetCurrentLevelRank(state, players[i].Team));
                var bRank = GetEffectiveRank(b, GetCurrentLevelRank(state, players[i].Team));
                if (aRank != bRank) return aRank.CompareTo(bRank);
                return string.Compare(a.Suit, b.Suit, StringComparison.Ordinal);
            });
            players[i].CardsRemaining = 27;
            players[i].IsFinished = false;
            players[i].FinishOrder = 0;
        }

        state.CurrentPlayJson = "[]";
        state.CurrentPlayType = "";
        state.ConsecutivePasses = 0;
        state.FinishOrderJson = "[]";
        state.Phase = "Playing";
        state.CurrentPlayerIndex = state.DealerIndex;
        state.LastPlayerIndex = -1;
        state.TributeStateJson = "{}";
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return state;
    }

    private int GetCurrentLevelRank(GuandanGameState state, string team)
    {
        return team == "A" ? state.TeamALevel : state.TeamBLevel;
    }

    /// <summary>Classify a set of cards into a combination type. Returns null if invalid.</summary>
    public static string? ClassifyCombination(List<GuandanCard> cards, int levelRank)
    {
        if (cards == null || cards.Count == 0) return null;
        int count = cards.Count;

        // Sort by effective rank
        var sorted = cards.OrderBy(c => GetEffectiveRank(c, levelRank)).ToList();

        // Check Joker Bomb: all 4 jokers
        if (count == 4 && cards.All(c => c.Rank >= 16))
            return "JokerBomb";

        // Single
        if (count == 1) return "Single";

        // Pair
        if (count == 2 && SameEffectiveRank(sorted, levelRank))
            return "Pair";

        // Triple
        if (count == 3 && SameEffectiveRank(sorted, levelRank))
            return "Triple";

        // Bomb: 4+ cards of same rank
        if (count >= 4 && SameEffectiveRank(sorted, levelRank))
            return $"Bomb{count}";

        // Full House: 3+2
        if (count == 5)
        {
            var groups = GroupByEffectiveRank(sorted, levelRank);
            if (groups.Count == 2)
            {
                var counts = groups.Values.OrderBy(v => v).ToList();
                if (counts[0] == 2 && counts[1] == 3) return "FullHouse";
            }
        }

        // Straight: 5 consecutive cards (using effective rank)
        if (count == 5 && IsStraight(sorted, levelRank))
        {
            // Check Straight Flush: all same suit
            if (cards.All(c => c.Suit == cards[0].Suit) && cards.All(c => c.Rank < 16))
                return "StraightFlush";
            return "Straight";
        }

        // Tube (连对): 3 consecutive pairs = 6 cards
        if (count == 6 && IsTube(sorted, levelRank))
            return "Tube";

        // Plate (钢板): 2 consecutive triples = 6 cards
        if (count == 6 && IsPlate(sorted, levelRank))
            return "Plate";

        return null;
    }

    private static bool SameEffectiveRank(List<GuandanCard> cards, int levelRank)
    {
        if (cards.Count <= 1) return true;
        var firstRank = GetEffectiveRank(cards[0], levelRank);
        return cards.All(c => GetEffectiveRank(c, levelRank) == firstRank);
    }

    private static Dictionary<int, int> GroupByEffectiveRank(List<GuandanCard> cards, int levelRank)
    {
        var groups = new Dictionary<int, int>();
        foreach (var c in cards)
        {
            var r = GetEffectiveRank(c, levelRank);
            groups[r] = groups.GetValueOrDefault(r, 0) + 1;
        }
        return groups;
    }

    private static bool IsStraight(List<GuandanCard> cards, int levelRank)
    {
        if (cards.Count != 5) return false;
        // No jokers in straights
        if (cards.Any(c => c.Rank >= 16)) return false;

        var ranks = cards.Select(c => GetEffectiveRank(c, levelRank)).OrderBy(r => r).ToList();
        // Must be 5 distinct consecutive ranks
        if (ranks.Distinct().Count() != 5) return false;

        // Check consecutive
        for (int i = 1; i < 5; i++)
        {
            if (ranks[i] != ranks[i - 1] + 1) return false;
        }

        // No straights that wrap around through level cards (15) in a weird way
        // A straight can go 2-3-4-5-6 through 10-J-Q-K-A(14) or include level rank(15) naturally
        return true;
    }

    private static bool IsTube(List<GuandanCard> cards, int levelRank)
    {
        if (cards.Count != 6) return false;
        if (cards.Any(c => c.Rank >= 16)) return false;

        var groups = GroupByEffectiveRank(cards, levelRank);
        if (groups.Count != 3 || groups.Values.Any(v => v != 2)) return false;

        var ranks = groups.Keys.OrderBy(r => r).ToList();
        return ranks[1] == ranks[0] + 1 && ranks[2] == ranks[1] + 1;
    }

    private static bool IsPlate(List<GuandanCard> cards, int levelRank)
    {
        if (cards.Count != 6) return false;
        if (cards.Any(c => c.Rank >= 16)) return false;

        var groups = GroupByEffectiveRank(cards, levelRank);
        if (groups.Count != 2 || groups.Values.Any(v => v != 3)) return false;

        var ranks = groups.Keys.OrderBy(r => r).ToList();
        return ranks[1] == ranks[0] + 1;
    }

    /// <summary>Get the "strength" of a combination for comparison. Higher = stronger.</summary>
    private static int GetCombinationStrength(string comboType)
    {
        // Bomb hierarchy: normal < Bomb4 < Bomb5 < StraightFlush < Bomb6 < Bomb7 < Bomb8 < JokerBomb
        return comboType switch
        {
            "Single" => 0,
            "Pair" => 0,
            "Triple" => 0,
            "FullHouse" => 0,
            "Straight" => 0,
            "Tube" => 0,
            "Plate" => 0,
            "Bomb4" => 100,
            "Bomb5" => 200,
            "StraightFlush" => 300,
            "Bomb6" => 400,
            "Bomb7" => 500,
            "Bomb8" => 600,
            _ when comboType.StartsWith("Bomb") => 600 + (int.TryParse(comboType[4..], out var n) ? n * 100 : 0),
            "JokerBomb" => 10000,
            _ => -1
        };
    }

    /// <summary>Check if playedCards can beat currentCards.</summary>
    public static bool CanBeat(List<GuandanCard> playedCards, string playedType, List<GuandanCard> currentCards, string currentType, int levelRank)
    {
        if (currentCards.Count == 0) return true; // Leading: can play anything

        int playedStrength = GetCombinationStrength(playedType);
        int currentStrength = GetCombinationStrength(currentType);

        // If played is a bomb and current is not, played wins
        if (playedStrength > 0 && currentStrength == 0) return true;

        // If both are bombs, compare bomb hierarchy
        if (playedStrength > 0 && currentStrength > 0)
        {
            if (playedStrength != currentStrength) return playedStrength > currentStrength;
            // Same bomb level — compare by rank
            var playedRank = GetHighRank(playedCards, levelRank);
            var currentRank = GetHighRank(currentCards, levelRank);
            return playedRank > currentRank;
        }

        // Normal combination: must be same type
        if (playedType != currentType) return false;
        if (playedCards.Count != currentCards.Count) return false;

        // Compare by determining rank
        var pRank = GetHighRank(playedCards, levelRank);
        var cRank = GetHighRank(currentCards, levelRank);

        if (playedType == "FullHouse")
        {
            // Compare by the triple part
            pRank = GetTripleRank(playedCards, levelRank);
            cRank = GetTripleRank(currentCards, levelRank);
        }

        return pRank > cRank;
    }

    private static int GetHighRank(List<GuandanCard> cards, int levelRank)
    {
        return cards.Max(c => GetEffectiveRank(c, levelRank));
    }

    private static int GetTripleRank(List<GuandanCard> cards, int levelRank)
    {
        var groups = GroupByEffectiveRank(cards, levelRank);
        return groups.Where(g => g.Value == 3).Select(g => g.Key).FirstOrDefault();
    }

    /// <summary>Play cards from a player's hand.</summary>
    public async Task<(GuandanGameState state, string? error)> PlayCards(int roomId, string playerName, List<GuandanCard> cardsToPlay)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Playing") return (state, "Game is not in playing phase");

        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var currentPlayer = players[state.CurrentPlayerIndex];
        if (currentPlayer.Name != playerName) return (state, "Not your turn");
        if (currentPlayer.IsFinished) return (state, "You have already finished");

        // Determine the level rank for the current player's team
        var levelRank = GetCurrentLevelRank(state, currentPlayer.Team);

        // Classify the combination
        var comboType = ClassifyCombination(cardsToPlay, levelRank);
        if (comboType == null) return (state, "Invalid card combination");

        // Verify player has these cards
        var handCopy = new List<GuandanCard>(currentPlayer.Hand);
        foreach (var card in cardsToPlay)
        {
            var idx = handCopy.FindIndex(c => c.Rank == card.Rank && c.Suit == card.Suit);
            if (idx < 0) return (state, "You don't have those cards");
            handCopy.RemoveAt(idx);
        }

        // Check if this beats the current play (if not leading)
        var currentPlay = JsonSerializer.Deserialize<List<GuandanCard>>(state.CurrentPlayJson, _jsonOpts) ?? [];
        if (currentPlay.Count > 0)
        {
            if (!CanBeat(cardsToPlay, comboType, currentPlay, state.CurrentPlayType, levelRank))
                return (state, "Your play doesn't beat the current play");
        }

        // Remove cards from hand
        currentPlayer.Hand = handCopy;
        currentPlayer.CardsRemaining = handCopy.Count;

        // Update current play
        state.CurrentPlayJson = JsonSerializer.Serialize(cardsToPlay, _jsonOpts);
        state.CurrentPlayType = comboType;
        state.LastPlayerIndex = state.CurrentPlayerIndex;
        state.ConsecutivePasses = 0;

        // Check if player has finished
        var finishOrder = JsonSerializer.Deserialize<List<string>>(state.FinishOrderJson, _jsonOpts) ?? [];
        if (currentPlayer.CardsRemaining == 0)
        {
            currentPlayer.IsFinished = true;
            finishOrder.Add(currentPlayer.Name);
            currentPlayer.FinishOrder = finishOrder.Count;
            state.FinishOrderJson = JsonSerializer.Serialize(finishOrder, _jsonOpts);
        }

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);

        // Check if round is over (3 players finished, or both partners of a team finished)
        if (finishOrder.Count >= 3)
        {
            // Round over
            await EndRound(state, players, finishOrder);
        }
        else
        {
            // Advance to next active player
            AdvanceToNextPlayer(state, players);
        }

        await SaveState(state);
        return (state, null);
    }

    /// <summary>Pass (don't play).</summary>
    public async Task<(GuandanGameState state, string? error)> Pass(int roomId, string playerName)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "Playing") return (state, "Game is not in playing phase");

        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var currentPlayer = players[state.CurrentPlayerIndex];
        if (currentPlayer.Name != playerName) return (state, "Not your turn");

        // Can't pass if you're leading (no current play)
        var currentPlay = JsonSerializer.Deserialize<List<GuandanCard>>(state.CurrentPlayJson, _jsonOpts) ?? [];
        if (currentPlay.Count == 0) return (state, "You must play when leading");

        state.ConsecutivePasses++;

        // Count how many active (non-finished) players there are
        int activePlayers = players.Count(p => !p.IsFinished);

        // If all other active players passed, the last player who played leads again
        // We need (activePlayers - 1) passes for the trick to go back to the last player
        // But we also need to handle the case where the last player who played has finished
        int passesNeeded = activePlayers - 1;
        if (state.LastPlayerIndex >= 0 && players[state.LastPlayerIndex].IsFinished)
        {
            // The last player has gone out. Their partner continues from lead.
            passesNeeded = activePlayers; // All active players must pass
        }

        if (state.ConsecutivePasses >= passesNeeded)
        {
            // Trick won. Start new trick.
            state.CurrentPlayJson = "[]";
            state.CurrentPlayType = "";
            state.ConsecutivePasses = 0;

            if (state.LastPlayerIndex >= 0 && players[state.LastPlayerIndex].IsFinished)
            {
                // Partner of the finished player leads
                var finishedPlayer = players[state.LastPlayerIndex];
                var partnerIdx = GetPartnerIndex(state.LastPlayerIndex);
                if (!players[partnerIdx].IsFinished)
                {
                    state.CurrentPlayerIndex = partnerIdx;
                }
                else
                {
                    // Both partners finished; advance to next non-finished player
                    AdvanceToNextPlayer(state, players);
                }
            }
            else if (state.LastPlayerIndex >= 0)
            {
                state.CurrentPlayerIndex = state.LastPlayerIndex;
            }
            else
            {
                AdvanceToNextPlayer(state, players);
            }
        }
        else
        {
            AdvanceToNextPlayer(state, players);
        }

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
        return (state, null);
    }

    private static int GetPartnerIndex(int seatIndex)
    {
        // Seats: 0&2 are partners (Team A), 1&3 are partners (Team B)
        return seatIndex switch
        {
            0 => 2,
            1 => 3,
            2 => 0,
            3 => 1,
            _ => 0
        };
    }

    private void AdvanceToNextPlayer(GuandanGameState state, List<GuandanPlayer> players)
    {
        int startIdx = state.CurrentPlayerIndex;
        // Counterclockwise: seats go 0 -> 3 -> 2 -> 1 -> 0 (or we can simplify to 0->1->2->3->0)
        // For simplicity, advance numerically and wrap around
        for (int i = 1; i <= 4; i++)
        {
            int nextIdx = (startIdx + i) % 4;
            if (!players[nextIdx].IsFinished)
            {
                state.CurrentPlayerIndex = nextIdx;
                return;
            }
        }
        // All players finished (shouldn't happen normally)
        state.CurrentPlayerIndex = startIdx;
    }

    private Task EndRound(GuandanGameState state, List<GuandanPlayer> players, List<string> finishOrder)
    {
        // The 4th (last) player who hasn't finished is the dweller
        var lastPlayer = players.First(p => !p.IsFinished);
        finishOrder.Add(lastPlayer.Name);
        lastPlayer.FinishOrder = 4;
        lastPlayer.IsFinished = true;
        state.FinishOrderJson = JsonSerializer.Serialize(finishOrder, _jsonOpts);
        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);

        // Determine winning team (team of the first player who finished)
        var bankerName = finishOrder[0];
        var banker = players.First(p => p.Name == bankerName);
        var winningTeam = banker.Team;

        // Check partner's finish position
        var partnerIdx = GetPartnerIndex(banker.SeatIndex);
        var partner = players[partnerIdx];
        var partnerOrder = partner.FinishOrder;

        int levelAdvance = 0;
        if (partnerOrder == 2) levelAdvance = 3;       // Partner is Follower (2nd)
        else if (partnerOrder == 3) levelAdvance = 2;   // Partner is Third
        else if (partnerOrder == 4) levelAdvance = 1;   // Partner is Dweller

        // Advance winning team's level
        if (winningTeam == "A")
        {
            state.TeamALevel = Math.Min(14, state.TeamALevel + levelAdvance);
        }
        else
        {
            state.TeamBLevel = Math.Min(14, state.TeamBLevel + levelAdvance);
        }

        // Check for game over (team at level A=14 wins with the advancement)
        bool gameOver = false;
        if (winningTeam == "A" && state.TeamALevel >= 14) gameOver = true;
        if (winningTeam == "B" && state.TeamBLevel >= 14) gameOver = true;

        state.Phase = gameOver ? "GameOver" : "RoundEnd";

        // Set dealer for next round: the dweller leads in next round
        state.DealerIndex = lastPlayer.SeatIndex;

        return Task.CompletedTask;
    }

    /// <summary>Handle tribute payment between rounds.</summary>
    public async Task<(GuandanGameState state, string? error)> PayTribute(int roomId, string playerName, GuandanCard card)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        if (state.Phase != "TributePhase") return (state, "Not in tribute phase");

        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var tributeState = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(state.TributeStateJson, _jsonOpts) ?? [];

        // Find the player
        var player = players.FirstOrDefault(p => p.Name == playerName);
        if (player == null) return (state, "Player not found");

        // Verify card is in player's hand
        var cardIdx = player.Hand.FindIndex(c => c.Rank == card.Rank && c.Suit == card.Suit);
        if (cardIdx < 0) return (state, "Card not in hand");

        // Remove card from hand
        player.Hand.RemoveAt(cardIdx);
        player.CardsRemaining = player.Hand.Count;

        // Give card to tribute recipient (banker)
        var finishOrder = JsonSerializer.Deserialize<List<string>>(state.FinishOrderJson, _jsonOpts) ?? [];
        var bankerName = finishOrder[0];
        var bankerPlayer = players.First(p => p.Name == bankerName);
        bankerPlayer.Hand.Add(card);
        bankerPlayer.CardsRemaining = bankerPlayer.Hand.Count;

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        state.Phase = "Playing"; // Simplified: go directly to playing after tribute
        await SaveState(state);
        return (state, null);
    }

    /// <summary>Sanitize game state for a specific player (hide other players' hands).</summary>
    public static string SanitizeStateForPlayer(GuandanGameState state, string playerName)
    {
        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var currentPlay = JsonSerializer.Deserialize<List<GuandanCard>>(state.CurrentPlayJson, _jsonOpts) ?? [];
        var finishOrder = JsonSerializer.Deserialize<List<string>>(state.FinishOrderJson, _jsonOpts) ?? [];

        var sanitizedPlayers = players.Select(p => new GuandanPlayerView
        {
            Name = p.Name,
            Team = p.Team,
            SeatIndex = p.SeatIndex,
            CardsRemaining = p.CardsRemaining,
            IsFinished = p.IsFinished,
            FinishOrder = p.FinishOrder,
            Hand = p.Name == playerName ? p.Hand : null // Only show own hand
        }).ToList();

        var response = new GuandanStateResponse
        {
            Id = state.Id,
            RoomId = state.RoomId,
            Phase = state.Phase,
            CurrentPlayerIndex = state.CurrentPlayerIndex,
            LastPlayerIndex = state.LastPlayerIndex,
            CurrentPlay = currentPlay,
            CurrentPlayType = state.CurrentPlayType,
            TeamALevel = state.TeamALevel,
            TeamBLevel = state.TeamBLevel,
            RoundNumber = state.RoundNumber,
            Players = sanitizedPlayers,
            FinishOrder = finishOrder,
            DealerIndex = state.DealerIndex,
            ConsecutivePasses = state.ConsecutivePasses
        };

        return JsonSerializer.Serialize(response, _jsonOpts);
    }

    /// <summary>Sanitize state with no specific player (show no hands).</summary>
    public static string SanitizeState(GuandanGameState state)
    {
        return SanitizeStateForPlayer(state, "");
    }

    public GuandanStateResponse ToResponse(GuandanGameState state)
    {
        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];
        var currentPlay = JsonSerializer.Deserialize<List<GuandanCard>>(state.CurrentPlayJson, _jsonOpts) ?? [];
        var finishOrder = JsonSerializer.Deserialize<List<string>>(state.FinishOrderJson, _jsonOpts) ?? [];

        var sanitizedPlayers = players.Select(p => new GuandanPlayerView
        {
            Name = p.Name,
            Team = p.Team,
            SeatIndex = p.SeatIndex,
            CardsRemaining = p.CardsRemaining,
            IsFinished = p.IsFinished,
            FinishOrder = p.FinishOrder,
            Hand = null
        }).ToList();

        return new GuandanStateResponse
        {
            Id = state.Id,
            RoomId = state.RoomId,
            Phase = state.Phase,
            CurrentPlayerIndex = state.CurrentPlayerIndex,
            LastPlayerIndex = state.LastPlayerIndex,
            CurrentPlay = currentPlay,
            CurrentPlayType = state.CurrentPlayType,
            TeamALevel = state.TeamALevel,
            TeamBLevel = state.TeamBLevel,
            RoundNumber = state.RoundNumber,
            Players = sanitizedPlayers,
            FinishOrder = finishOrder,
            DealerIndex = state.DealerIndex,
            ConsecutivePasses = state.ConsecutivePasses
        };
    }
}
