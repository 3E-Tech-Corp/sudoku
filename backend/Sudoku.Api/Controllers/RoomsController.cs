using Microsoft.AspNetCore.Mvc;
using Sudoku.Api.Models;
using Sudoku.Api.Services;

namespace Sudoku.Api.Controllers;

[ApiController]
[Route("[controller]")]
public class RoomsController : ControllerBase
{
    private readonly RoomService _roomService;

    public RoomsController(RoomService roomService)
    {
        _roomService = roomService;
    }

    [HttpPost]
    public async Task<IActionResult> CreateRoom([FromBody] CreateRoomRequest request)
    {
        var result = await _roomService.CreateRoom(request);
        return Ok(result);
    }

    [HttpGet("public")]
    public async Task<IActionResult> ListPublicRooms()
    {
        var rooms = await _roomService.ListPublicRooms();
        return Ok(rooms);
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> GetRoom(string code)
    {
        var room = await _roomService.GetRoom(code.ToUpper());
        if (room == null) return NotFound(new { message = "Room not found" });
        return Ok(room);
    }

    [HttpPost("{code}/join")]
    public async Task<IActionResult> JoinRoom(string code, [FromBody] JoinRoomRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName))
            return BadRequest(new { message = "Display name is required" });

        var result = await _roomService.JoinRoom(code.ToUpper(), request);
        if (result == null) return NotFound(new { message = "Room not found" });
        return Ok(result);
    }
}
