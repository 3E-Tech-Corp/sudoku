using Microsoft.AspNetCore.SignalR;
using Sudoku.Api.Services;

namespace Sudoku.Api.Hubs;

public class SudokuHub : Hub
{
    private readonly RoomService _roomService;

    public SudokuHub(RoomService roomService)
    {
        _roomService = roomService;
    }

    public async Task JoinRoom(string code, string displayName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, code.ToUpper());
        await Clients.Group(code.ToUpper()).SendAsync("PlayerJoined", displayName);
    }

    public async Task LeaveRoom(string code, string displayName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, code.ToUpper());
        await Clients.Group(code.ToUpper()).SendAsync("PlayerLeft", displayName);
    }

    public async Task PlaceNumber(string code, int row, int col, int value, string player)
    {
        code = code.ToUpper();
        var mode = await _roomService.GetRoomMode(code);

        if (mode == "Competitive")
        {
            var (isComplete, filledCount, rank) = await _roomService.CompetitivePlaceNumber(code, player, row, col, value);

            // Broadcast progress update to all players (but not the actual move)
            await Clients.Group(code).SendAsync("ProgressUpdated", player, filledCount);

            // Send the actual board update only to the caller
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
            // Notes are private in competitive mode - save to server but don't broadcast
            await _roomService.CompetitiveToggleNote(code, player, row, col, value);
        }
        else
        {
            var updatedNotes = await _roomService.ToggleNote(code, row, col, value);
            await Clients.Group(code).SendAsync("NoteUpdated", row, col, updatedNotes, player);
        }
    }
}
