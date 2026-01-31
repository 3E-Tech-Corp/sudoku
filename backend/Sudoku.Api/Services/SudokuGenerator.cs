namespace Sudoku.Api.Services;

public class SudokuGenerator
{
    private static readonly Random _rng = new();

    public (int[][] puzzle, int[][] solution) Generate(string difficulty)
    {
        var board = new int[9][];
        for (int i = 0; i < 9; i++)
            board[i] = new int[9];

        FillBoard(board);

        var solution = board.Select(r => r.ToArray()).ToArray();

        int cellsToRemove = difficulty.ToLower() switch
        {
            "easy" => 36,
            "medium" => 46,
            "hard" => 54,
            _ => 46
        };

        RemoveCells(board, cellsToRemove);

        return (board, solution);
    }

    private bool FillBoard(int[][] board)
    {
        var empty = FindEmpty(board);
        if (empty == null) return true;

        int row = empty.Value.row;
        int col = empty.Value.col;

        var numbers = Enumerable.Range(1, 9).OrderBy(_ => _rng.Next()).ToArray();

        foreach (int num in numbers)
        {
            if (IsValid(board, row, col, num))
            {
                board[row][col] = num;
                if (FillBoard(board))
                    return true;
                board[row][col] = 0;
            }
        }

        return false;
    }

    private void RemoveCells(int[][] board, int count)
    {
        var positions = new List<(int r, int c)>();
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                positions.Add((r, c));

        // Shuffle positions
        for (int i = positions.Count - 1; i > 0; i--)
        {
            int j = _rng.Next(i + 1);
            (positions[i], positions[j]) = (positions[j], positions[i]);
        }

        int removed = 0;
        foreach (var (r, c) in positions)
        {
            if (removed >= count) break;

            int backup = board[r][c];
            board[r][c] = 0;

            // Check uniqueness by counting solutions
            if (CountSolutions(board, 2) == 1)
            {
                removed++;
            }
            else
            {
                board[r][c] = backup;
            }
        }
    }

    private int CountSolutions(int[][] board, int max)
    {
        var copy = board.Select(r => r.ToArray()).ToArray();
        int count = 0;
        CountSolutionsHelper(copy, ref count, max);
        return count;
    }

    private void CountSolutionsHelper(int[][] board, ref int count, int max)
    {
        if (count >= max) return;

        var empty = FindEmpty(board);
        if (empty == null)
        {
            count++;
            return;
        }

        int row = empty.Value.row;
        int col = empty.Value.col;

        for (int num = 1; num <= 9; num++)
        {
            if (count >= max) return;
            if (IsValid(board, row, col, num))
            {
                board[row][col] = num;
                CountSolutionsHelper(board, ref count, max);
                board[row][col] = 0;
            }
        }
    }

    private (int row, int col)? FindEmpty(int[][] board)
    {
        for (int r = 0; r < 9; r++)
            for (int c = 0; c < 9; c++)
                if (board[r][c] == 0) return (r, c);
        return null;
    }

    private bool IsValid(int[][] board, int row, int col, int num)
    {
        // Check row
        for (int c = 0; c < 9; c++)
            if (board[row][c] == num) return false;

        // Check column
        for (int r = 0; r < 9; r++)
            if (board[r][col] == num) return false;

        // Check 3x3 box
        int boxRow = (row / 3) * 3;
        int boxCol = (col / 3) * 3;
        for (int r = boxRow; r < boxRow + 3; r++)
            for (int c = boxCol; c < boxCol + 3; c++)
                if (board[r][c] == num) return false;

        return true;
    }
}
