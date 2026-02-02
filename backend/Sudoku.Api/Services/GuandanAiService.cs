using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

/// <summary>
/// AI player logic for Guandan (掼蛋), adapted from the demo GuandanEngine.
/// Works with the existing GuandanCard model (int Rank, string Suit).
///
/// Strategy:
/// - When leading: play weakest non-bomb group to conserve strength
/// - When responding: play smallest combination that beats current play
/// - Save bombs as last resort (use only when few cards remain)
/// - Pass when can't beat and no bombs worth using
/// - Respects "triple cannot be with single" (三带二 only, no 三带一)
/// </summary>
public static class GuandanAiService
{
    /// <summary>
    /// Decide what to play for an AI player.
    /// Returns null to pass, or a list of cards to play.
    /// </summary>
    public static List<GuandanCard>? DecidePlay(
        List<GuandanCard> hand,
        List<GuandanCard> currentPlay,
        string currentPlayType,
        int levelRank,
        bool isLeading)
    {
        if (hand.Count == 0) return null;

        if (isLeading)
            return DecideLead(hand, levelRank);
        else
            return DecideResponse(hand, currentPlay, currentPlayType, levelRank);
    }

    // ==================== Leading Logic ====================

    private static List<GuandanCard>? DecideLead(List<GuandanCard> hand, int levelRank)
    {
        // Group the hand using greedy heuristic
        var groups = GroupHand(hand, levelRank);

        // Lead with weakest non-bomb group first
        var nonBombs = groups
            .Where(g => !IsBombType(g.type))
            .OrderBy(g => LeadPriority(g.type))
            .ThenBy(g => GetGroupStrength(g.cards, levelRank))
            .ToList();

        if (nonBombs.Count > 0)
            return nonBombs[0].cards;

        // Only bombs left — play weakest bomb
        var bombs = groups
            .Where(g => IsBombType(g.type))
            .OrderBy(g => GetGroupStrength(g.cards, levelRank))
            .ToList();

        if (bombs.Count > 0)
            return bombs[0].cards;

        // Fallback: play lowest single
        return [hand.OrderBy(c => GuandanService.GetEffectiveRank(c, levelRank)).First()];
    }

    // ==================== Response Logic ====================

    private static List<GuandanCard>? DecideResponse(
        List<GuandanCard> hand,
        List<GuandanCard> currentPlay,
        string currentPlayType,
        int levelRank)
    {
        // Try to find a matching combination that beats the current play
        var candidates = FindBeatingCombinations(hand, currentPlay, currentPlayType, levelRank);

        if (candidates.Count > 0)
        {
            // Play the weakest beating combination to conserve strong cards
            return candidates
                .OrderBy(c => GetGroupStrength(c, levelRank))
                .First();
        }

        // Consider bombs as last resort — only if few cards remain
        if (hand.Count <= 12)
        {
            var bombPlay = FindBeatingBomb(hand, currentPlay, currentPlayType, levelRank);
            if (bombPlay != null)
                return bombPlay;
        }

        // Pass
        return null;
    }

    /// <summary>Find all combinations of the required type that beat the current play.</summary>
    private static List<List<GuandanCard>> FindBeatingCombinations(
        List<GuandanCard> hand,
        List<GuandanCard> currentPlay,
        string currentPlayType,
        int levelRank)
    {
        var results = new List<List<GuandanCard>>();

        switch (currentPlayType)
        {
            case "Single":
                FindBeatingSingles(hand, currentPlay, levelRank, results);
                break;
            case "Pair":
                FindBeatingPairs(hand, currentPlay, levelRank, results);
                break;
            case "Triple":
                FindBeatingTriples(hand, currentPlay, levelRank, results);
                break;
            case "FullHouse":
                FindBeatingFullHouses(hand, currentPlay, levelRank, results);
                break;
            case "Straight":
                FindBeatingStraights(hand, currentPlay, levelRank, results);
                break;
            case "Tube":
                FindBeatingTubes(hand, currentPlay, levelRank, results);
                break;
            case "Plate":
                FindBeatingPlates(hand, currentPlay, levelRank, results);
                break;
            // For bomb types, handled separately in FindBeatingBomb
        }

        return results;
    }

    private static void FindBeatingSingles(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        foreach (var card in hand)
        {
            var rank = GuandanService.GetEffectiveRank(card, levelRank);
            if (rank > currentRank)
                results.Add([card]);
        }
    }

    private static void FindBeatingPairs(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var byRank = hand.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));

        foreach (var g in byRank)
        {
            if (g.Count() >= 2 && g.Key > currentRank)
            {
                results.Add(g.Take(2).ToList());
            }
        }
    }

    private static void FindBeatingTriples(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var byRank = hand.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));

        foreach (var g in byRank)
        {
            if (g.Count() >= 3 && g.Key > currentRank)
            {
                results.Add(g.Take(3).ToList());
            }
        }
    }

    private static void FindBeatingFullHouses(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        // FullHouse = 三带二 (trips + pair), compared by triple rank
        var currentTripleRank = GetTripleRank(currentPlay, levelRank);

        var byRank = hand.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        var tripRanks = byRank.Where(kv => kv.Value.Count >= 3 && kv.Key > currentTripleRank)
            .Select(kv => kv.Key)
            .OrderBy(r => r)
            .ToList();

        foreach (var tr in tripRanks)
        {
            // Find any pair (different rank preferred, same rank if 5+ cards)
            var pairRank = byRank
                .Where(kv => kv.Value.Count >= 2 && (kv.Key != tr || kv.Value.Count >= 5))
                .Select(kv => kv.Key)
                .OrderBy(r => r)
                .FirstOrDefault();

            if (pairRank == 0 && !byRank.ContainsKey(0)) continue;

            var trip = byRank[tr].Take(3).ToList();
            var pairSource = byRank[pairRank];
            var skip = tr == pairRank ? 3 : 0;
            var pair = pairSource.Skip(skip).Take(2).ToList();

            if (trip.Count == 3 && pair.Count == 2)
            {
                results.Add(trip.Concat(pair).ToList());
            }
        }
    }

    private static void FindBeatingStraights(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var candidates = hand.Where(c => c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        // Find all 5-card consecutive runs that have a higher max rank
        var ranks = byRank.Keys.OrderBy(r => r).ToList();
        for (int i = 0; i <= ranks.Count - 5; i++)
        {
            // Check if 5 consecutive
            if (ranks[i + 4] - ranks[i] == 4)
            {
                bool consecutive = true;
                for (int j = 1; j < 5; j++)
                {
                    if (ranks[i + j] != ranks[i] + j) { consecutive = false; break; }
                }
                if (!consecutive) continue;

                var highRank = ranks[i + 4];
                if (highRank <= currentHighRank) continue;

                var cards = new List<GuandanCard>();
                for (int j = 0; j < 5; j++)
                {
                    cards.Add(byRank[ranks[i + j]][0]);
                }
                results.Add(cards);
            }
        }
    }

    private static void FindBeatingTubes(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        // Tube = 3 consecutive pairs (6 cards)
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var candidates = hand.Where(c => c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .Where(g => g.Count() >= 2)
            .ToDictionary(g => g.Key, g => g.ToList());

        var ranks = byRank.Keys.OrderBy(r => r).ToList();
        for (int i = 0; i <= ranks.Count - 3; i++)
        {
            if (ranks[i + 2] - ranks[i] == 2 && ranks[i + 1] == ranks[i] + 1)
            {
                var highRank = ranks[i + 2];
                if (highRank <= currentHighRank) continue;

                var cards = new List<GuandanCard>();
                for (int j = 0; j < 3; j++)
                {
                    cards.AddRange(byRank[ranks[i + j]].Take(2));
                }
                results.Add(cards);
            }
        }
    }

    private static void FindBeatingPlates(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        // Plate = 2 consecutive triples (6 cards)
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var candidates = hand.Where(c => c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .Where(g => g.Count() >= 3)
            .ToDictionary(g => g.Key, g => g.ToList());

        var ranks = byRank.Keys.OrderBy(r => r).ToList();
        for (int i = 0; i <= ranks.Count - 2; i++)
        {
            if (ranks[i + 1] == ranks[i] + 1)
            {
                var highRank = ranks[i + 1];
                if (highRank <= currentHighRank) continue;

                var cards = new List<GuandanCard>();
                for (int j = 0; j < 2; j++)
                {
                    cards.AddRange(byRank[ranks[i + j]].Take(3));
                }
                results.Add(cards);
            }
        }
    }

    /// <summary>Find a bomb that beats the current play (any type).</summary>
    private static List<GuandanCard>? FindBeatingBomb(
        List<GuandanCard> hand,
        List<GuandanCard> currentPlay,
        string currentPlayType,
        int levelRank)
    {
        var bombs = new List<(string type, List<GuandanCard> cards)>();

        // Check for 4+ of a kind bombs
        var byRank = hand.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));

        foreach (var g in byRank)
        {
            if (g.Count() >= 4)
            {
                var cards = g.ToList();
                var type = $"Bomb{cards.Count}";
                if (GuandanService.CanBeat(cards, type, currentPlay, currentPlayType, levelRank))
                    bombs.Add((type, cards));
            }
        }

        // Check for straight flushes (5 same suit consecutive)
        foreach (var suit in new[] { "Hearts", "Diamonds", "Clubs", "Spades" })
        {
            var suited = hand.Where(c => c.Suit == suit && c.Rank < 16).ToList();
            if (suited.Count < 5) continue;

            var suitByRank = suited
                .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
                .ToDictionary(g => g.Key, g => g.First());

            var suitRanks = suitByRank.Keys.OrderBy(r => r).ToList();
            for (int i = 0; i <= suitRanks.Count - 5; i++)
            {
                if (suitRanks[i + 4] - suitRanks[i] == 4)
                {
                    bool consecutive = true;
                    for (int j = 1; j < 5; j++)
                    {
                        if (suitRanks[i + j] != suitRanks[i] + j) { consecutive = false; break; }
                    }
                    if (!consecutive) continue;

                    var cards = new List<GuandanCard>();
                    for (int j = 0; j < 5; j++)
                        cards.Add(suitByRank[suitRanks[i + j]]);

                    if (GuandanService.CanBeat(cards, "StraightFlush", currentPlay, currentPlayType, levelRank))
                        bombs.Add(("StraightFlush", cards));
                }
            }
        }

        // Check for joker bomb (4 jokers)
        var jokers = hand.Where(c => c.Rank >= 16).ToList();
        if (jokers.Count >= 4)
        {
            var jb = jokers.Take(4).ToList();
            if (GuandanService.CanBeat(jb, "JokerBomb", currentPlay, currentPlayType, levelRank))
                bombs.Add(("JokerBomb", jb));
        }

        // Return weakest usable bomb
        return bombs
            .OrderBy(b => BombStrength(b.type))
            .ThenBy(b => GetGroupStrength(b.cards, levelRank))
            .Select(b => b.cards)
            .FirstOrDefault();
    }

    // ==================== Hand Grouping (for leading) ====================

    /// <summary>Group a hand into playable combinations using a greedy heuristic.</summary>
    private static List<(string type, List<GuandanCard> cards)> GroupHand(List<GuandanCard> hand, int levelRank)
    {
        var groups = new List<(string type, List<GuandanCard> cards)>();
        var pool = hand.ToList();

        // 1. Joker Bomb
        ExtractJokerBomb(pool, groups);

        // 2. Regular bombs (4+ of same effective rank)
        ExtractBombs(pool, groups, levelRank);

        // 3. Straight flushes
        ExtractStraightFlushes(pool, groups, levelRank);

        // 4. Straights (5 consecutive)
        ExtractStraights(pool, groups, levelRank);

        // 5. Tubes (3 consecutive pairs)
        ExtractTubes(pool, groups, levelRank);

        // 6. Plates (2 consecutive triples)
        ExtractPlates(pool, groups, levelRank);

        // 7. FullHouse (三带二)
        ExtractFullHouses(pool, groups, levelRank);

        // 8. Pairs
        ExtractPairsFromPool(pool, groups, levelRank);

        // 9. Triples (bare)
        ExtractTriplesFromPool(pool, groups, levelRank);

        // 10. Remaining as singles
        foreach (var card in pool.OrderBy(c => GuandanService.GetEffectiveRank(c, levelRank)))
        {
            groups.Add(("Single", [card]));
        }

        return groups;
    }

    private static void ExtractJokerBomb(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups)
    {
        var jokers = pool.Where(c => c.Rank >= 16).ToList();
        if (jokers.Count >= 4)
        {
            var bomb = jokers.Take(4).ToList();
            foreach (var c in bomb) pool.Remove(c);
            groups.Add(("JokerBomb", bomb));
        }
    }

    private static void ExtractBombs(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        var byRank = pool.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .Where(g => g.Count() >= 4)
            .OrderByDescending(g => g.Count())
            .ToList();

        foreach (var g in byRank)
        {
            var cards = g.ToList();
            foreach (var c in cards) pool.Remove(c);
            groups.Add(($"Bomb{cards.Count}", cards));
        }
    }

    private static void ExtractStraightFlushes(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        foreach (var suit in new[] { "Hearts", "Diamonds", "Clubs", "Spades" })
        {
            while (true)
            {
                var suited = pool.Where(c => c.Suit == suit && c.Rank < 16).ToList();
                if (suited.Count < 5) break;

                var byRank = suited
                    .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
                    .ToDictionary(g => g.Key, g => g.ToList());

                var run = FindLongestRun(byRank, 5);
                if (run == null) break;

                var take = run.Take(5).ToList();
                var cards = new List<GuandanCard>();
                foreach (var rank in take)
                {
                    var card = byRank[rank][0];
                    cards.Add(card);
                    pool.Remove(card);
                }
                groups.Add(("StraightFlush", cards));
            }
        }
    }

    private static void ExtractStraights(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        while (true)
        {
            var candidates = pool.Where(c => c.Rank < 16).ToList();
            var byRank = candidates
                .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
                .ToDictionary(g => g.Key, g => g.ToList());

            var run = FindLongestRun(byRank, 5);
            if (run == null) break;

            var take = run.Take(5).ToList();
            var cards = new List<GuandanCard>();
            foreach (var rank in take)
            {
                var card = byRank[rank][0];
                cards.Add(card);
                pool.Remove(card);
            }
            groups.Add(("Straight", cards));
        }
    }

    private static void ExtractTubes(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        var candidates = pool.Where(c => c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .Where(g => g.Count() >= 2)
            .ToDictionary(g => g.Key, g => g.ToList());

        var ranks = byRank.Keys.OrderBy(r => r).ToList();
        for (int i = 0; i <= ranks.Count - 3; i++)
        {
            if (ranks[i + 2] == ranks[i] + 2 && ranks[i + 1] == ranks[i] + 1)
            {
                var cards = new List<GuandanCard>();
                for (int j = 0; j < 3; j++)
                {
                    var pair = byRank[ranks[i + j]].Take(2).ToList();
                    cards.AddRange(pair);
                    foreach (var c in pair) pool.Remove(c);
                }
                groups.Add(("Tube", cards));
                break; // Greedy
            }
        }
    }

    private static void ExtractPlates(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        var candidates = pool.Where(c => c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .Where(g => g.Count() >= 3)
            .ToDictionary(g => g.Key, g => g.ToList());

        var ranks = byRank.Keys.OrderBy(r => r).ToList();
        for (int i = 0; i <= ranks.Count - 2; i++)
        {
            if (ranks[i + 1] == ranks[i] + 1)
            {
                var cards = new List<GuandanCard>();
                for (int j = 0; j < 2; j++)
                {
                    var trips = byRank[ranks[i + j]].Take(3).ToList();
                    cards.AddRange(trips);
                    foreach (var c in trips) pool.Remove(c);
                }
                groups.Add(("Plate", cards));
                break;
            }
        }
    }

    private static void ExtractFullHouses(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        while (true)
        {
            var candidates = pool.Where(c => c.Rank < 16).ToList();
            var byRank = candidates
                .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
                .ToDictionary(g => g.Key, g => g.ToList());

            var tripRanks = byRank.Where(kv => kv.Value.Count >= 3).Select(kv => kv.Key).OrderBy(r => r).ToList();
            if (tripRanks.Count == 0) break;

            bool found = false;
            foreach (var tr in tripRanks)
            {
                var pairRank = byRank
                    .Where(kv => kv.Value.Count >= 2 && (kv.Key != tr || kv.Value.Count >= 5))
                    .Select(kv => kv.Key)
                    .OrderBy(r => r)
                    .Cast<int?>()
                    .FirstOrDefault();

                if (pairRank == null) continue;

                var trip = byRank[tr].Take(3).ToList();
                var skip = tr == pairRank ? 3 : 0;
                var pair = byRank[pairRank.Value].Skip(skip).Take(2).ToList();

                if (trip.Count == 3 && pair.Count == 2)
                {
                    var cards = trip.Concat(pair).ToList();
                    foreach (var c in cards) pool.Remove(c);
                    groups.Add(("FullHouse", cards));
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }
    }

    private static void ExtractPairsFromPool(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        var toRemove = new List<GuandanCard>();
        var byRank = pool.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .OrderBy(g => g.Key)
            .ToList();

        foreach (var g in byRank)
        {
            var list = g.ToList();
            while (list.Count >= 2)
            {
                var pair = list.Take(2).ToList();
                list.RemoveRange(0, 2);
                toRemove.AddRange(pair);
                groups.Add(("Pair", pair));
            }
        }
        foreach (var c in toRemove) pool.Remove(c);
    }

    private static void ExtractTriplesFromPool(List<GuandanCard> pool, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        var toRemove = new List<GuandanCard>();
        var byRank = pool.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .OrderBy(g => g.Key)
            .ToList();

        foreach (var g in byRank)
        {
            var list = g.ToList();
            while (list.Count >= 3)
            {
                var trips = list.Take(3).ToList();
                list.RemoveRange(0, 3);
                toRemove.AddRange(trips);
                groups.Add(("Triple", trips));
            }
        }
        foreach (var c in toRemove) pool.Remove(c);
    }

    // ==================== Helpers ====================

    private static List<int>? FindLongestRun(Dictionary<int, List<GuandanCard>> byRank, int minLength)
    {
        var sortedRanks = byRank.Where(kv => kv.Value.Count > 0)
            .Select(kv => kv.Key)
            .OrderByDescending(r => r)
            .ToList();

        List<int>? bestRun = null;

        for (int start = 0; start < sortedRanks.Count; start++)
        {
            var run = new List<int> { sortedRanks[start] };
            for (int i = start + 1; i < sortedRanks.Count; i++)
            {
                if (sortedRanks[i] == run.Last() - 1)
                    run.Add(sortedRanks[i]);
                else
                    break;
            }
            if (run.Count >= minLength && (bestRun == null || run.Count > bestRun.Count))
                bestRun = run;
        }

        return bestRun;
    }

    private static bool IsBombType(string type)
    {
        return type.StartsWith("Bomb") || type == "JokerBomb" || type == "StraightFlush";
    }

    private static int LeadPriority(string type)
    {
        return type switch
        {
            "Single" => 1,
            "Pair" => 2,
            "Triple" => 3,
            "FullHouse" => 4,
            "Straight" => 5,
            "Tube" => 6,
            "Plate" => 7,
            _ => 0
        };
    }

    private static int GetGroupStrength(List<GuandanCard> cards, int levelRank)
    {
        return cards.Max(c => GuandanService.GetEffectiveRank(c, levelRank)) * 10 + cards.Count;
    }

    private static int GetTripleRank(List<GuandanCard> cards, int levelRank)
    {
        var groups = cards.GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));
        return groups.Where(g => g.Count() >= 3).Select(g => g.Key).FirstOrDefault();
    }

    private static int BombStrength(string type)
    {
        return type switch
        {
            "Bomb4" => 100,
            "Bomb5" => 200,
            "StraightFlush" => 300,
            "Bomb6" => 400,
            "Bomb7" => 500,
            "Bomb8" => 600,
            _ when type.StartsWith("Bomb") => 600 + (int.TryParse(type[4..], out var n) ? n * 100 : 0),
            "JokerBomb" => 10000,
            _ => 0
        };
    }
}
