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

    private static readonly string[] BotNames = ["Bot Alice", "Bot Bob", "Bot Carol"];

    /// <summary>Fill empty seats with AI bot players.</summary>
    public async Task<GuandanGameState> FillWithBots(int roomId)
    {
        var state = await GetGameState(roomId) ?? throw new InvalidOperationException("No game state");
        var players = JsonSerializer.Deserialize<List<GuandanPlayer>>(state.PlayersJson, _jsonOpts) ?? [];

        int botIndex = 0;
        while (players.Count < 4)
        {
            var seatIndex = players.Count;
            var team = (seatIndex % 2 == 0) ? "A" : "B";
            // Pick a unique bot name
            string botName;
            do
            {
                botName = botIndex < BotNames.Length ? BotNames[botIndex] : $"Bot {botIndex + 1}";
                botIndex++;
            } while (players.Any(p => p.Name == botName));

            players.Add(new GuandanPlayer
            {
                Name = botName,
                Hand = [],
                Team = team,
                SeatIndex = seatIndex,
                CardsRemaining = 0,
                IsFinished = false,
                FinishOrder = 0,
                IsBot = true
            });
        }

        state.PlayersJson = JsonSerializer.Serialize(players, _jsonOpts);
        await SaveState(state);
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
            players[i].LastPlayCards = [];
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

    /// <summary>Classify a set of cards into a combination type. Returns null if invalid.
    /// Supports wild cards (heart of current level rank) that can substitute for any non-joker card.</summary>
    public static string? ClassifyCombination(List<GuandanCard> cards, int levelRank)
    {
        if (cards == null || cards.Count == 0) return null;
        int count = cards.Count;

        // Joker Bomb: all 4 jokers
        if (count == 4 && cards.All(c => c.Rank >= 16))
            return "JokerBomb";

        // Separate wild cards from non-wilds
        var wilds = cards.Where(c => IsWild(c, levelRank)).ToList();
        var nonWilds = cards.Where(c => !IsWild(c, levelRank)).ToList();
        int wildCount = wilds.Count;

        // If wilds are mixed with jokers, invalid (wilds can't substitute for jokers)
        if (wildCount > 0 && nonWilds.Any(c => c.Rank >= 16))
            return null;

        // All cards are wilds → treat as same-rank group (effective rank 15)
        if (nonWilds.Count == 0)
        {
            return count switch
            {
                1 => "Single",
                2 => "Pair",
                3 => "Triple",
                _ => $"Bomb{count}"
            };
        }

        // Single
        if (count == 1) return "Single";

        // Group non-wilds by effective rank
        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        // Same-rank combinations (Pair, Triple, Bomb)
        if (groups.Count == 1)
        {
            // All non-wilds are the same rank, wilds augment
            if (nonWilds.Count + wildCount == count)
            {
                return count switch
                {
                    2 => "Pair",
                    3 => "Triple",
                    _ when count >= 4 => $"Bomb{count}",
                    _ => null
                };
            }
        }

        bool hasJokers = nonWilds.Any(c => c.Rank >= 16);

        // Full House: 5 cards = triple + pair
        if (count == 5 && !hasJokers && TryFullHouseWithWilds(nonWilds, wildCount, levelRank))
            return "FullHouse";

        // Straight: 5 consecutive cards
        if (count == 5 && !hasJokers && TryStraightWithWilds(nonWilds, wildCount, levelRank))
        {
            // Check Straight Flush: all non-wild cards same suit (wilds fill in as that suit)
            if (IsStraightFlushWithWilds(nonWilds))
                return "StraightFlush";
            return "Straight";
        }

        // Tube (连对): 3 consecutive pairs = 6 cards
        if (count == 6 && !hasJokers && TryTubeWithWilds(nonWilds, wildCount, levelRank))
            return "Tube";

        // Plate (钢板): 2 consecutive triples = 6 cards
        if (count == 6 && !hasJokers && TryPlateWithWilds(nonWilds, wildCount, levelRank))
            return "Plate";

        return null;
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

    /// <summary>Check if non-wilds + wilds can form a Full House (3+2).</summary>
    private static bool TryFullHouseWithWilds(List<GuandanCard> nonWilds, int wildCount, int levelRank)
    {
        if (nonWilds.Count + wildCount != 5) return false;
        if (nonWilds.Any(c => c.Rank >= 16)) return false;

        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        // Try each rank as the triple
        foreach (var (tripleRank, tripleHave) in groups)
        {
            int tripleNeed = Math.Max(0, 3 - tripleHave);
            if (tripleNeed > wildCount) continue;

            int usedForTriple = Math.Min(tripleHave, 3);
            int leftoverWilds = wildCount - tripleNeed;

            // Remaining non-wilds not used in triple
            var remaining = new Dictionary<int, int>(groups);
            remaining[tripleRank] -= usedForTriple;
            if (remaining[tripleRank] <= 0) remaining.Remove(tripleRank);

            int remainingNonWildCount = remaining.Values.Sum();
            int totalForPair = remainingNonWildCount + leftoverWilds;

            if (totalForPair != 2) continue;

            // Check: remaining non-wilds should form a valid pair
            if (remainingNonWildCount == 0) return true;  // 2 wilds form the pair
            if (remainingNonWildCount == 1) return true;  // 1 non-wild + 1 wild
            if (remainingNonWildCount == 2 && remaining.Count == 1) return true; // 2 same rank
        }

        return false;
    }

    /// <summary>Check if non-wilds + wilds can form a Straight (5 consecutive ranks).</summary>
    private static bool TryStraightWithWilds(List<GuandanCard> nonWilds, int wildCount, int levelRank)
    {
        if (nonWilds.Count + wildCount != 5) return false;
        if (nonWilds.Any(c => c.Rank >= 16)) return false;

        if (nonWilds.Count == 0) return wildCount == 5; // all wilds

        var ranks = nonWilds.Select(c => GetEffectiveRank(c, levelRank)).ToList();
        var distinctRanks = ranks.Distinct().OrderBy(r => r).ToList();

        // Non-wilds must have all distinct ranks (no duplicate ranks in a straight)
        if (distinctRanks.Count != nonWilds.Count) return false;

        int minR = distinctRanks.First();
        int maxR = distinctRanks.Last();

        // Try all possible windows of 5 consecutive ranks
        int startMin = Math.Max(2, maxR - 4);
        int startMax = Math.Min(minR, 11); // start + 4 <= 15
        if (startMin > startMax) return false;

        for (int start = startMin; start <= startMax; start++)
        {
            int end = start + 4;
            if (minR < start || maxR > end) continue;

            int covered = distinctRanks.Count(r => r >= start && r <= end);
            int needed = 5 - covered;
            if (needed == wildCount) return true;
        }

        return false;
    }

    /// <summary>Check if all non-wild cards are the same suit (for straight flush with wilds).</summary>
    private static bool IsStraightFlushWithWilds(List<GuandanCard> nonWilds)
    {
        if (nonWilds.Count == 0) return true; // all wilds
        var suit = nonWilds[0].Suit;
        return nonWilds.All(c => c.Suit == suit);
    }

    /// <summary>Check if non-wilds + wilds can form a Tube (3 consecutive pairs).</summary>
    private static bool TryTubeWithWilds(List<GuandanCard> nonWilds, int wildCount, int levelRank)
    {
        if (nonWilds.Count + wildCount != 6) return false;
        if (nonWilds.Any(c => c.Rank >= 16)) return false;

        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        for (int start = 2; start + 2 <= 15; start++)
        {
            // All non-wild ranks must be in [start, start+2]
            if (groups.Keys.Any(r => r < start || r > start + 2)) continue;

            int wildsNeeded = 0;
            bool valid = true;
            for (int r = start; r <= start + 2; r++)
            {
                int have = groups.GetValueOrDefault(r, 0);
                if (have > 2) { valid = false; break; }
                wildsNeeded += (2 - have);
            }

            if (valid && wildsNeeded == wildCount) return true;
        }

        return false;
    }

    /// <summary>Check if non-wilds + wilds can form a Plate (2 consecutive triples).</summary>
    private static bool TryPlateWithWilds(List<GuandanCard> nonWilds, int wildCount, int levelRank)
    {
        if (nonWilds.Count + wildCount != 6) return false;
        if (nonWilds.Any(c => c.Rank >= 16)) return false;

        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        for (int start = 2; start + 1 <= 15; start++)
        {
            if (groups.Keys.Any(r => r < start || r > start + 1)) continue;

            int wildsNeeded = 0;
            bool valid = true;
            for (int r = start; r <= start + 1; r++)
            {
                int have = groups.GetValueOrDefault(r, 0);
                if (have > 3) { valid = false; break; }
                wildsNeeded += (3 - have);
            }

            if (valid && wildsNeeded == wildCount) return true;
        }

        return false;
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

    /// <summary>Check if playedCards can beat currentCards. Wild-card aware.</summary>
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
            // Same bomb level — compare by rank (wild-aware)
            var playedRank = GetCombinationRank(playedCards, playedType, levelRank);
            var currentRank = GetCombinationRank(currentCards, currentType, levelRank);
            return playedRank > currentRank;
        }

        // Normal combination: must be same type
        if (playedType != currentType) return false;
        if (playedCards.Count != currentCards.Count) return false;

        // Compare by wild-aware combination rank
        var pRank = GetCombinationRank(playedCards, playedType, levelRank);
        var cRank = GetCombinationRank(currentCards, currentType, levelRank);
        return pRank > cRank;
    }

    /// <summary>Get the representative rank of a combination, considering wild cards.
    /// For same-rank combos: the non-wild cards' rank. For sequences: the highest rank in the sequence.</summary>
    private static int GetCombinationRank(List<GuandanCard> cards, string comboType, int levelRank)
    {
        var nonWilds = cards.Where(c => !IsWild(c, levelRank)).ToList();

        if (nonWilds.Count == 0)
            return 15; // All wilds = level rank effective

        switch (comboType)
        {
            case "FullHouse":
                return GetTripleRankWithWilds(cards, levelRank);
            case "Straight":
            case "StraightFlush":
                return GetStraightHighRank(nonWilds, cards.Count(c => IsWild(c, levelRank)), levelRank);
            case "Tube":
                return GetSequenceHighRank(nonWilds, 2, 3, cards.Count(c => IsWild(c, levelRank)), levelRank);
            case "Plate":
                return GetSequenceHighRank(nonWilds, 3, 2, cards.Count(c => IsWild(c, levelRank)), levelRank);
            default:
                // Single, Pair, Triple, Bomb: rank is the non-wild cards' effective rank
                return nonWilds.Max(c => GetEffectiveRank(c, levelRank));
        }
    }

    /// <summary>Get the triple rank from a Full House, considering wilds.</summary>
    private static int GetTripleRankWithWilds(List<GuandanCard> cards, int levelRank)
    {
        var nonWilds = cards.Where(c => !IsWild(c, levelRank)).ToList();
        int wildCount = cards.Count(c => IsWild(c, levelRank));

        if (nonWilds.Count == 0) return 15;

        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        // Find the highest rank that can serve as the triple
        foreach (var (rank, count) in groups.OrderByDescending(g => g.Key))
        {
            int tripleNeed = Math.Max(0, 3 - count);
            if (tripleNeed > wildCount) continue;

            int usedForTriple = Math.Min(count, 3);
            int leftoverWilds = wildCount - tripleNeed;

            var remaining = new Dictionary<int, int>(groups);
            remaining[rank] -= usedForTriple;
            if (remaining[rank] <= 0) remaining.Remove(rank);

            int remainingCount = remaining.Values.Sum();
            int totalForPair = remainingCount + leftoverWilds;

            if (totalForPair == 2)
            {
                if (remainingCount <= 1 || (remainingCount == 2 && remaining.Count == 1))
                    return rank;
            }
        }

        // Fallback: original logic
        return groups.OrderByDescending(g => g.Value).ThenByDescending(g => g.Key).First().Key;
    }

    /// <summary>Get the highest rank of a straight, considering wilds filling gaps.</summary>
    private static int GetStraightHighRank(List<GuandanCard> nonWilds, int wildCount, int levelRank)
    {
        if (nonWilds.Count == 0) return 6; // all wilds, default

        var ranks = nonWilds.Select(c => GetEffectiveRank(c, levelRank)).Distinct().OrderBy(r => r).ToList();
        int minR = ranks.First();
        int maxR = ranks.Last();

        // Try from highest possible window down to find the best interpretation
        int startMax = Math.Min(minR, 11);
        int startMin = Math.Max(2, maxR - 4);

        for (int start = startMax; start >= startMin; start--)
        {
            int end = start + 4;
            if (end > 15) continue;
            if (minR < start || maxR > end) continue;

            int covered = ranks.Count(r => r >= start && r <= end);
            int needed = 5 - covered;
            if (needed == wildCount) return end;
        }

        return maxR; // fallback
    }

    /// <summary>Get the highest rank of a sequence combo (Tube or Plate), considering wilds.</summary>
    private static int GetSequenceHighRank(List<GuandanCard> nonWilds, int groupSize, int groupCount, int wildCount, int levelRank)
    {
        var groups = GroupByEffectiveRank(nonWilds, levelRank);

        // Find the highest valid window
        for (int start = 14; start >= 2; start--)
        {
            int end = start + groupCount - 1;
            if (end > 15) continue;

            if (groups.Keys.Any(r => r < start || r > end)) continue;

            int needed = 0;
            bool valid = true;
            for (int r = start; r <= end; r++)
            {
                int have = groups.GetValueOrDefault(r, 0);
                if (have > groupSize) { valid = false; break; }
                needed += (groupSize - have);
            }

            if (valid && needed == wildCount) return end;
        }

        return nonWilds.Count > 0 ? nonWilds.Max(c => GetEffectiveRank(c, levelRank)) : 15;
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

        // Track last played cards for this player
        currentPlayer.LastPlayCards = new List<GuandanCard>(cardsToPlay);

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
            // Trick won. Start new trick — clear all players' last play.
            foreach (var p in players) p.LastPlayCards = [];
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
        // Counterclockwise: seats go 0 -> 3 -> 2 -> 1 -> 0
        for (int i = 1; i <= 4; i++)
        {
            int nextIdx = (startIdx - i + 4) % 4;
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
            Hand = p.Name == playerName ? p.Hand : null, // Only show own hand
            IsBot = p.IsBot,
            LastPlayCards = p.LastPlayCards.Count > 0 ? p.LastPlayCards : null // Show all players' last play
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
            Hand = null,
            IsBot = p.IsBot,
            LastPlayCards = p.LastPlayCards.Count > 0 ? p.LastPlayCards : null
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
