using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

/// <summary>
/// AI player logic for Guandan (掼蛋), adapted from the demo GuandanEngine.
/// Works with the existing GuandanCard model (int Rank, string Suit).
/// Supports wild cards (heart of current level rank).
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
        var currentRank = currentPlay.Where(c => !GuandanService.IsWild(c, levelRank))
            .Select(c => GuandanService.GetEffectiveRank(c, levelRank))
            .DefaultIfEmpty(15)
            .Max();

        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var nonWilds = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();

        // Standard pairs (no wilds)
        var byRank = nonWilds.GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));
        foreach (var g in byRank)
        {
            if (g.Count() >= 2 && g.Key > currentRank)
                results.Add(g.Take(2).ToList());
        }

        // Wild-enhanced pairs: single non-wild + 1 wild
        if (wilds.Count > 0)
        {
            var seenRanks = new HashSet<int>();
            foreach (var g in nonWilds.GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank)).OrderBy(g => g.Key))
            {
                if (g.Key > currentRank && seenRanks.Add(g.Key))
                {
                    results.Add([g.First(), wilds[0]]);
                }
            }

            // Two wilds as a pair (rank 15)
            if (wilds.Count >= 2 && 15 > currentRank)
                results.Add(wilds.Take(2).ToList());
        }
    }

    private static void FindBeatingTriples(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentRank = currentPlay.Where(c => !GuandanService.IsWild(c, levelRank))
            .Select(c => GuandanService.GetEffectiveRank(c, levelRank))
            .DefaultIfEmpty(15)
            .Max();

        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var nonWilds = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();

        var byRank = nonWilds.GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));
        foreach (var g in byRank)
        {
            if (g.Count() >= 3 && g.Key > currentRank)
                results.Add(g.Take(3).ToList());

            // Pair + 1 wild = triple
            if (g.Count() >= 2 && g.Count() < 3 && wilds.Count >= 1 && g.Key > currentRank)
                results.Add(g.Take(2).Concat(wilds.Take(1)).ToList());

            // Single + 2 wilds = triple
            if (g.Count() >= 1 && g.Count() < 2 && wilds.Count >= 2 && g.Key > currentRank)
                results.Add(g.Take(1).Concat(wilds.Take(2)).ToList());
        }
    }

    private static void FindBeatingFullHouses(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentTripleRank = GetTripleRank(currentPlay, levelRank);

        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var nonWilds = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();

        var byRank = nonWilds
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        // Find triples (including wild-enhanced) with rank > currentTripleRank
        var tripCandidates = new List<(int rank, List<GuandanCard> cards, int wildsUsed)>();
        foreach (var (rank, cards) in byRank)
        {
            if (rank <= currentTripleRank) continue;
            if (cards.Count >= 3)
                tripCandidates.Add((rank, cards.Take(3).ToList(), 0));
            if (cards.Count >= 2 && wilds.Count >= 1)
                tripCandidates.Add((rank, cards.Take(2).Concat(wilds.Take(1)).ToList(), 1));
            if (cards.Count >= 1 && wilds.Count >= 2)
                tripCandidates.Add((rank, cards.Take(1).Concat(wilds.Take(2)).ToList(), 2));
        }

        foreach (var (tripRank, tripCards, wildsUsed) in tripCandidates.OrderBy(t => t.rank))
        {
            int remainingWilds = wilds.Count - wildsUsed;

            // Find a pair from remaining cards
            var pairRank = byRank
                .Where(kv => kv.Value.Count >= 2 && (kv.Key != tripRank || kv.Value.Count >= 5))
                .Select(kv => kv.Key)
                .OrderBy(r => r)
                .Cast<int?>()
                .FirstOrDefault();

            if (pairRank != null)
            {
                var skip = tripRank == pairRank ? 3 : 0;
                var pair = byRank[pairRank.Value].Skip(skip).Take(2).ToList();
                if (pair.Count == 2)
                {
                    results.Add(tripCards.Concat(pair).ToList());
                    continue;
                }
            }

            // Try wild-enhanced pair: single + remaining wild
            if (remainingWilds >= 1)
            {
                var singleForPair = byRank
                    .Where(kv => kv.Key != tripRank && kv.Value.Count >= 1)
                    .Select(kv => kv.Key)
                    .OrderBy(r => r)
                    .Cast<int?>()
                    .FirstOrDefault();

                if (singleForPair != null)
                {
                    var wildForPair = wilds.Skip(wildsUsed).Take(1).ToList();
                    results.Add(tripCards.Concat([byRank[singleForPair.Value][0]]).Concat(wildForPair).ToList());
                    continue;
                }
            }

            // Try 2 remaining wilds as pair
            if (remainingWilds >= 2)
            {
                var wildPair = wilds.Skip(wildsUsed).Take(2).ToList();
                results.Add(tripCards.Concat(wildPair).ToList());
            }
        }
    }

    private static void FindBeatingStraights(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var candidates = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        var ranks = byRank.Keys.OrderBy(r => r).ToList();

        // Try all 5-card consecutive windows
        for (int start = 2; start + 4 <= 15; start++)
        {
            int end = start + 4;
            if (end <= currentHighRank) continue;

            int gaps = 0;
            var cards = new List<GuandanCard>();

            for (int r = start; r <= end; r++)
            {
                if (byRank.ContainsKey(r))
                    cards.Add(byRank[r][0]);
                else
                    gaps++;
            }

            if (gaps > wilds.Count) continue;
            if (gaps > 0)
                cards.AddRange(wilds.Take(gaps));

            if (cards.Count == 5)
            {
                // Validate
                var type = GuandanService.ClassifyCombination(cards, levelRank);
                if (type == "Straight" && GuandanService.CanBeat(cards, type, currentPlay, "Straight", levelRank))
                    results.Add(cards);
            }
        }
    }

    private static void FindBeatingTubes(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        // Tube = 3 consecutive pairs (6 cards)
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var candidates = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        for (int start = 2; start + 2 <= 15; start++)
        {
            int end = start + 2;
            if (end <= currentHighRank) continue;

            int wildsNeeded = 0;
            var cards = new List<GuandanCard>();

            for (int r = start; r <= end; r++)
            {
                int have = byRank.ContainsKey(r) ? Math.Min(byRank[r].Count, 2) : 0;
                if (have > 0) cards.AddRange(byRank[r].Take(have));
                wildsNeeded += (2 - have);
            }

            if (wildsNeeded > wilds.Count) continue;
            if (wildsNeeded > 0) cards.AddRange(wilds.Take(wildsNeeded));

            if (cards.Count == 6)
            {
                var type = GuandanService.ClassifyCombination(cards, levelRank);
                if (type == "Tube" && GuandanService.CanBeat(cards, type, currentPlay, "Tube", levelRank))
                    results.Add(cards);
            }
        }
    }

    private static void FindBeatingPlates(List<GuandanCard> hand, List<GuandanCard> currentPlay, int levelRank, List<List<GuandanCard>> results)
    {
        // Plate = 2 consecutive triples (6 cards)
        var currentHighRank = currentPlay.Max(c => GuandanService.GetEffectiveRank(c, levelRank));
        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var candidates = hand.Where(c => !GuandanService.IsWild(c, levelRank) && c.Rank < 16).ToList();
        var byRank = candidates
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        for (int start = 2; start + 1 <= 15; start++)
        {
            int end = start + 1;
            if (end <= currentHighRank) continue;

            int wildsNeeded = 0;
            var cards = new List<GuandanCard>();

            for (int r = start; r <= end; r++)
            {
                int have = byRank.ContainsKey(r) ? Math.Min(byRank[r].Count, 3) : 0;
                if (have > 0) cards.AddRange(byRank[r].Take(have));
                wildsNeeded += (3 - have);
            }

            if (wildsNeeded > wilds.Count) continue;
            if (wildsNeeded > 0) cards.AddRange(wilds.Take(wildsNeeded));

            if (cards.Count == 6)
            {
                var type = GuandanService.ClassifyCombination(cards, levelRank);
                if (type == "Plate" && GuandanService.CanBeat(cards, type, currentPlay, "Plate", levelRank))
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
        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var nonWilds = hand.Where(c => !GuandanService.IsWild(c, levelRank)).ToList();

        // Check for 4+ of a kind bombs (including wild-enhanced)
        var byRank = nonWilds.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));

        foreach (var g in byRank)
        {
            var groupCards = g.ToList();

            // Pure bomb (no wilds)
            if (groupCards.Count >= 4)
            {
                var type = $"Bomb{groupCards.Count}";
                if (GuandanService.CanBeat(groupCards, type, currentPlay, currentPlayType, levelRank))
                    bombs.Add((type, groupCards));
            }

            // Wild-enhanced bombs: 3 + wild(s)
            if (groupCards.Count >= 3 && wilds.Count >= 1)
            {
                var bombCards = groupCards.Take(3).Concat(wilds.Take(1)).ToList();
                var type = "Bomb4";
                if (GuandanService.CanBeat(bombCards, type, currentPlay, currentPlayType, levelRank))
                    bombs.Add((type, bombCards));

                // 3 + 2 wilds = Bomb5
                if (wilds.Count >= 2)
                {
                    var bomb5Cards = groupCards.Take(3).Concat(wilds.Take(2)).ToList();
                    if (GuandanService.CanBeat(bomb5Cards, "Bomb5", currentPlay, currentPlayType, levelRank))
                        bombs.Add(("Bomb5", bomb5Cards));
                }
            }

            // 2 + 2 wilds = Bomb4
            if (groupCards.Count >= 2 && groupCards.Count < 3 && wilds.Count >= 2)
            {
                var bombCards = groupCards.Take(2).Concat(wilds.Take(2)).ToList();
                if (GuandanService.CanBeat(bombCards, "Bomb4", currentPlay, currentPlayType, levelRank))
                    bombs.Add(("Bomb4", bombCards));
            }
        }

        // Check for straight flushes (5 same suit consecutive, including wild-enhanced)
        foreach (var suit in new[] { "Hearts", "Diamonds", "Clubs", "Spades" })
        {
            var suited = nonWilds.Where(c => c.Suit == suit && c.Rank < 16).ToList();
            var suitByRank = suited
                .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
                .ToDictionary(g => g.Key, g => g.First());

            for (int start = 2; start + 4 <= 15; start++)
            {
                int end = start + 4;
                int gaps = 0;
                var cards = new List<GuandanCard>();

                for (int r = start; r <= end; r++)
                {
                    if (suitByRank.ContainsKey(r))
                        cards.Add(suitByRank[r]);
                    else
                        gaps++;
                }

                if (gaps > wilds.Count) continue;
                if (gaps > 0) cards.AddRange(wilds.Take(gaps));

                if (cards.Count == 5)
                {
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

    /// <summary>Group a hand into playable combinations using a greedy heuristic.
    /// Wilds are kept separate and used to enhance combos strategically.</summary>
    private static List<(string type, List<GuandanCard> cards)> GroupHand(List<GuandanCard> hand, int levelRank)
    {
        var groups = new List<(string type, List<GuandanCard> cards)>();
        var wilds = hand.Where(c => GuandanService.IsWild(c, levelRank)).ToList();
        var pool = hand.Where(c => !GuandanService.IsWild(c, levelRank)).ToList();

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

        // 8. Try to use wilds to enhance remaining cards
        UseWildsToEnhance(pool, wilds, groups, levelRank);

        // 9. Pairs
        ExtractPairsFromPool(pool, groups, levelRank);

        // 10. Triples (bare)
        ExtractTriplesFromPool(pool, groups, levelRank);

        // 11. Remaining non-wilds as singles
        foreach (var card in pool.OrderBy(c => GuandanService.GetEffectiveRank(c, levelRank)))
        {
            groups.Add(("Single", [card]));
        }

        // 12. Remaining wilds as singles (they're strong singles at rank 15)
        foreach (var w in wilds)
        {
            groups.Add(("Single", [w]));
        }

        return groups;
    }

    /// <summary>Use wilds to upgrade incomplete combos: single→pair, pair→triple, triple→bomb4.</summary>
    private static void UseWildsToEnhance(List<GuandanCard> pool, List<GuandanCard> wilds, List<(string type, List<GuandanCard> cards)> groups, int levelRank)
    {
        if (wilds.Count == 0) return;

        // Try to make bombs from triples + wild
        var byRank = pool.Where(c => c.Rank < 16)
            .GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank))
            .ToDictionary(g => g.Key, g => g.ToList());

        // Prefer upgrading triples to bomb4 (most valuable upgrade)
        foreach (var (rank, cards) in byRank.OrderByDescending(kv => kv.Key))
        {
            if (wilds.Count == 0) break;
            if (cards.Count == 3)
            {
                var bomb = cards.Concat(wilds.Take(1)).ToList();
                groups.Add(("Bomb4", bomb));
                foreach (var c in cards) pool.Remove(c);
                wilds.RemoveAt(0);
                byRank.Remove(rank);
            }
        }
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
        // Wild-aware: find the non-wild triple rank
        var nonWilds = cards.Where(c => !GuandanService.IsWild(c, levelRank)).ToList();
        if (nonWilds.Count == 0) return 15;
        var groups = nonWilds.GroupBy(c => GuandanService.GetEffectiveRank(c, levelRank));
        return groups.OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key).First().Key;
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
