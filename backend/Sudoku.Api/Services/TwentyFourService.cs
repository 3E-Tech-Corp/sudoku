using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;

namespace Sudoku.Api.Services;

public class TwentyFourService
{
    private readonly string _connectionString;
    private static readonly Random _rng = new();
    private static readonly string[] Suits = ["Hearts", "Diamonds", "Clubs", "Spades"];

    public TwentyFourService(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No connection string");
    }

    private SqlConnection GetConnection() => new(_connectionString);

    /// <summary>
    /// Generate a full shuffled deck of 52 cards
    /// </summary>
    public static List<TwentyFourCard> GenerateDeck()
    {
        var deck = new List<TwentyFourCard>();
        foreach (var suit in Suits)
        {
            for (int num = 1; num <= 13; num++)
            {
                deck.Add(new TwentyFourCard { Number = num, Suit = suit });
            }
        }
        // Fisher-Yates shuffle
        for (int i = deck.Count - 1; i > 0; i--)
        {
            int j = _rng.Next(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
        return deck;
    }

    /// <summary>
    /// Deal 4 cards from the deck, ensuring at least one solution exists.
    /// Returns (dealtCards, remainingDeck)
    /// </summary>
    public static (List<TwentyFourCard> dealt, List<TwentyFourCard> remaining) Deal4Cards(List<TwentyFourCard> deck)
    {
        // Try dealing from the deck first
        if (deck.Count >= 4)
        {
            var dealt = deck.Take(4).ToList();
            var remaining = deck.Skip(4).ToList();
            
            if (HasSolution(dealt[0].Number, dealt[1].Number, dealt[2].Number, dealt[3].Number))
            {
                return (dealt, remaining);
            }

            // If no solution, try shuffling remaining and re-dealing
            var allCards = new List<TwentyFourCard>(deck);
            for (int attempt = 0; attempt < 100; attempt++)
            {
                // Shuffle
                for (int i = allCards.Count - 1; i > 0; i--)
                {
                    int j = _rng.Next(i + 1);
                    (allCards[i], allCards[j]) = (allCards[j], allCards[i]);
                }
                dealt = allCards.Take(4).ToList();
                remaining = allCards.Skip(4).ToList();
                if (HasSolution(dealt[0].Number, dealt[1].Number, dealt[2].Number, dealt[3].Number))
                {
                    return (dealt, remaining);
                }
            }
        }

        // Fallback: generate a fresh deck and find a solvable hand
        var freshDeck = GenerateDeck();
        for (int attempt = 0; attempt < 200; attempt++)
        {
            var dealt = freshDeck.Take(4).ToList();
            var remaining = freshDeck.Skip(4).ToList();
            if (HasSolution(dealt[0].Number, dealt[1].Number, dealt[2].Number, dealt[3].Number))
            {
                return (dealt, remaining);
            }
            // Reshuffle
            for (int i = freshDeck.Count - 1; i > 0; i--)
            {
                int j = _rng.Next(i + 1);
                (freshDeck[i], freshDeck[j]) = (freshDeck[j], freshDeck[i]);
            }
        }

        // Ultimate fallback: known solvable hand (1, 2, 3, 4 → 1*2*3*4=24)
        return (
            [
                new TwentyFourCard { Number = 1, Suit = "Hearts" },
                new TwentyFourCard { Number = 2, Suit = "Diamonds" },
                new TwentyFourCard { Number = 3, Suit = "Clubs" },
                new TwentyFourCard { Number = 4, Suit = "Spades" }
            ],
            GenerateDeck().Skip(4).ToList()
        );
    }

    /// <summary>
    /// Check if there exists at least one valid solution for 4 numbers that makes 24.
    /// Solutions must use positive integer intermediate results only.
    /// </summary>
    public static bool HasSolution(int a, int b, int c, int d)
    {
        return FindAllSolutions(a, b, c, d).Count > 0;
    }

    /// <summary>
    /// Find all valid 3-step solutions for 4 numbers that make 24.
    /// Each step must produce a positive integer.
    /// </summary>
    public static List<List<TwentyFourStep>> FindAllSolutions(int a, int b, int c, int d)
    {
        var solutions = new List<List<TwentyFourStep>>();
        var seen = new HashSet<string>();
        var numbers = new[] { a, b, c, d };

        // Generate all permutations of indices
        var perms = GetPermutations([0, 1, 2, 3]);

        foreach (var perm in perms)
        {
            int n0 = numbers[perm[0]], n1 = numbers[perm[1]], n2 = numbers[perm[2]], n3 = numbers[perm[3]];

            // Structure 1: ((n0 op1 n1) op2 n2) op3 n3
            foreach (var op1 in GetOps())
            foreach (var op2 in GetOps())
            foreach (var op3 in GetOps())
            {
                var r1 = ApplyOp(n0, op1, n1);
                if (r1 == null) continue;
                var r2 = ApplyOp(r1.Value, op2, n2);
                if (r2 == null) continue;
                var r3 = ApplyOp(r2.Value, op3, n3);
                if (r3 == null || r3.Value != 24) continue;

                var steps = new List<TwentyFourStep>
                {
                    new() { Card1 = n0, Operation = op1, Card2 = n1, Result = r1.Value },
                    new() { Card1 = r1.Value, Operation = op2, Card2 = n2, Result = r2.Value },
                    new() { Card1 = r2.Value, Operation = op3, Card2 = n3, Result = r3.Value }
                };
                var key = StepsKey(steps);
                if (seen.Add(key)) solutions.Add(steps);
            }

            // Structure 2: (n0 op1 n1) op3 (n2 op2 n3)
            foreach (var op1 in GetOps())
            foreach (var op2 in GetOps())
            foreach (var op3 in GetOps())
            {
                var r1 = ApplyOp(n0, op1, n1);
                if (r1 == null) continue;
                var r2 = ApplyOp(n2, op2, n3);
                if (r2 == null) continue;
                var r3 = ApplyOp(r1.Value, op3, r2.Value);
                if (r3 == null || r3.Value != 24) continue;

                var steps = new List<TwentyFourStep>
                {
                    new() { Card1 = n0, Operation = op1, Card2 = n1, Result = r1.Value },
                    new() { Card1 = n2, Operation = op2, Card2 = n3, Result = r2.Value },
                    new() { Card1 = r1.Value, Operation = op3, Card2 = r2.Value, Result = r3.Value }
                };
                var key = StepsKey(steps);
                if (seen.Add(key)) solutions.Add(steps);
            }
        }

        return solutions;
    }

    private static string StepsKey(List<TwentyFourStep> steps)
    {
        return string.Join("|", steps.Select(s => $"{s.Card1}{s.Operation}{s.Card2}={s.Result}"));
    }

    private static string[] GetOps() => ["+", "-", "*", "/"];

    /// <summary>
    /// Apply operation. Returns null if result is not a positive integer.
    /// </summary>
    private static int? ApplyOp(int a, string op, int b)
    {
        int result = op switch
        {
            "+" => a + b,
            "-" => a - b,
            "*" => a * b,
            "/" when b != 0 && a % b == 0 => a / b,
            _ => -1
        };
        return result > 0 ? result : null;
    }

    private static List<int[]> GetPermutations(int[] arr)
    {
        var result = new List<int[]>();
        Permute(arr, 0, result);
        return result;
    }

    private static void Permute(int[] arr, int start, List<int[]> result)
    {
        if (start == arr.Length)
        {
            result.Add((int[])arr.Clone());
            return;
        }
        for (int i = start; i < arr.Length; i++)
        {
            (arr[start], arr[i]) = (arr[i], arr[start]);
            Permute(arr, start + 1, result);
            (arr[start], arr[i]) = (arr[i], arr[start]);
        }
    }

    /// <summary>
    /// Validate a single step: card1 op card2 = result, where result is a positive integer
    /// </summary>
    public static bool ValidateStep(int card1, string operation, int card2, int result)
    {
        var expected = ApplyOp(card1, operation, card2);
        return expected != null && expected.Value == result;
    }

    /// <summary>
    /// Validate a complete 3-step solution against the dealt cards
    /// </summary>
    public static bool ValidateSolution(int[] cardNumbers, List<TwentyFourStep> steps)
    {
        if (steps.Count != 3) return false;

        // Track available numbers (as a multiset)
        var available = new List<int>(cardNumbers);

        foreach (var step in steps)
        {
            // Check both cards are available
            if (!available.Remove(step.Card1)) return false;
            if (!available.Remove(step.Card2)) return false;

            // Validate the operation
            if (!ValidateStep(step.Card1, step.Operation, step.Card2, step.Result))
                return false;

            // Add result back to available
            available.Add(step.Result);
        }

        // After 3 steps, should have exactly one number left and it should be 24
        return available.Count == 1 && available[0] == 24;
    }

    /// <summary>
    /// Initialize a 24-game state for a room
    /// </summary>
    public async Task<TwentyFourGameState> InitializeGame(int roomId)
    {
        var deck = GenerateDeck();
        var (dealt, remaining) = Deal4Cards(deck);

        using var conn = GetConnection();
        await conn.OpenAsync();

        var id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO TwentyFourGameStates (RoomId, CardsJson, DeckJson, HandNumber, Status, ScoresJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @CardsJson, @DeckJson, 1, 'Playing', '{}')",
            new
            {
                RoomId = roomId,
                CardsJson = JsonSerializer.Serialize(dealt),
                DeckJson = JsonSerializer.Serialize(remaining)
            });

        return new TwentyFourGameState
        {
            Id = id,
            RoomId = roomId,
            CardsJson = JsonSerializer.Serialize(dealt),
            DeckJson = JsonSerializer.Serialize(remaining),
            HandNumber = 1,
            Status = "Playing",
            ScoresJson = "{}"
        };
    }

    /// <summary>
    /// Get the current game state for a room
    /// </summary>
    public async Task<TwentyFourGameState?> GetGameState(int roomId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        return await conn.QuerySingleOrDefaultAsync<TwentyFourGameState>(
            "SELECT TOP 1 * FROM TwentyFourGameStates WHERE RoomId = @RoomId ORDER BY Id DESC",
            new { RoomId = roomId });
    }

    /// <summary>
    /// Record a win and deal new hand
    /// </summary>
    public async Task<(TwentyFourGameState newState, Dictionary<string, int> scores)> RecordWinAndDealNew(
        int roomId, int gameStateId, string winnerName, List<TwentyFourStep> steps)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<TwentyFourGameState>(
            "SELECT * FROM TwentyFourGameStates WHERE Id = @Id", new { Id = gameStateId });

        // Update scores
        var scores = JsonSerializer.Deserialize<Dictionary<string, int>>(state.ScoresJson) ?? new();
        scores[winnerName] = scores.GetValueOrDefault(winnerName, 0) + 1;

        // Mark current hand as won
        await conn.ExecuteAsync(@"
            UPDATE TwentyFourGameStates 
            SET Status = 'Won', WinnerName = @Winner, WinningStepsJson = @Steps, ScoresJson = @Scores
            WHERE Id = @Id",
            new
            {
                Winner = winnerName,
                Steps = JsonSerializer.Serialize(steps),
                Scores = JsonSerializer.Serialize(scores),
                Id = gameStateId
            });

        // Deal new hand
        var deck = JsonSerializer.Deserialize<List<TwentyFourCard>>(state.DeckJson) ?? [];
        if (deck.Count < 4)
        {
            deck = GenerateDeck(); // reshuffle full deck
        }

        var (dealt, remaining) = Deal4Cards(deck);

        var newId = await conn.QuerySingleAsync<int>(@"
            INSERT INTO TwentyFourGameStates (RoomId, CardsJson, DeckJson, HandNumber, Status, ScoresJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @CardsJson, @DeckJson, @HandNumber, 'Playing', @Scores)",
            new
            {
                RoomId = roomId,
                CardsJson = JsonSerializer.Serialize(dealt),
                DeckJson = JsonSerializer.Serialize(remaining),
                HandNumber = state.HandNumber + 1,
                Scores = JsonSerializer.Serialize(scores)
            });

        return (new TwentyFourGameState
        {
            Id = newId,
            RoomId = roomId,
            CardsJson = JsonSerializer.Serialize(dealt),
            DeckJson = JsonSerializer.Serialize(remaining),
            HandNumber = state.HandNumber + 1,
            Status = "Playing",
            ScoresJson = JsonSerializer.Serialize(scores)
        }, scores);
    }

    /// <summary>
    /// Skip current hand and deal new
    /// </summary>
    public async Task<TwentyFourGameState> SkipAndDealNew(int roomId, int gameStateId)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();

        var state = await conn.QuerySingleAsync<TwentyFourGameState>(
            "SELECT * FROM TwentyFourGameStates WHERE Id = @Id", new { Id = gameStateId });

        // Mark as skipped
        await conn.ExecuteAsync(
            "UPDATE TwentyFourGameStates SET Status = 'Skipped' WHERE Id = @Id",
            new { Id = gameStateId });

        // Deal new
        var deck = JsonSerializer.Deserialize<List<TwentyFourCard>>(state.DeckJson) ?? [];
        if (deck.Count < 4) deck = GenerateDeck();

        var (dealt, remaining) = Deal4Cards(deck);
        var scores = state.ScoresJson;

        var newId = await conn.QuerySingleAsync<int>(@"
            INSERT INTO TwentyFourGameStates (RoomId, CardsJson, DeckJson, HandNumber, Status, ScoresJson)
            OUTPUT INSERTED.Id
            VALUES (@RoomId, @CardsJson, @DeckJson, @HandNumber, 'Playing', @Scores)",
            new
            {
                RoomId = roomId,
                CardsJson = JsonSerializer.Serialize(dealt),
                DeckJson = JsonSerializer.Serialize(remaining),
                HandNumber = state.HandNumber + 1,
                Scores = scores
            });

        return new TwentyFourGameState
        {
            Id = newId,
            RoomId = roomId,
            CardsJson = JsonSerializer.Serialize(dealt),
            DeckJson = JsonSerializer.Serialize(remaining),
            HandNumber = state.HandNumber + 1,
            Status = "Playing",
            ScoresJson = scores
        };
    }
}
