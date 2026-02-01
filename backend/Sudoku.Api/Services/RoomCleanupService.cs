using Microsoft.AspNetCore.SignalR;
using Sudoku.Api.Hubs;

namespace Sudoku.Api.Services;

/// <summary>
/// Background service that auto-closes rooms when the host has been gone for 5 minutes
/// and no other players are connected.
/// </summary>
public class RoomCleanupService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly IHubContext<GameHub> _hubContext;
    private readonly ILogger<RoomCleanupService> _logger;

    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan HostLeaveGrace = TimeSpan.FromMinutes(5);

    public RoomCleanupService(IServiceProvider services, IHubContext<GameHub> hubContext, ILogger<RoomCleanupService> logger)
    {
        _services = services;
        _hubContext = hubContext;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupAbandonedRooms();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during room cleanup");
            }

            await Task.Delay(CheckInterval, stoppingToken);
        }
    }

    private async Task CleanupAbandonedRooms()
    {
        var timers = GameHub.GetHostLeftTimers();
        var now = DateTime.UtcNow;

        foreach (var kvp in timers)
        {
            var roomCode = kvp.Key;
            var (hostName, leftAt) = kvp.Value;
            var elapsed = now - leftAt;

            if (elapsed < HostLeaveGrace) continue;

            // Check if anyone is still connected
            var connectedCount = GameHub.GetConnectedCount(roomCode);
            if (connectedCount > 0)
            {
                // Others are still playing — don't close yet, but remove the timer
                // (the room stays open as long as someone is connected)
                timers.TryRemove(roomCode, out _);
                continue;
            }

            // No one connected + host gone for 5+ min → close the room
            using var scope = _services.CreateScope();
            var roomService = scope.ServiceProvider.GetRequiredService<RoomService>();

            var closed = await roomService.CloseRoom(roomCode);
            if (closed)
            {
                _logger.LogInformation("Auto-closed room {Code} — host {Host} left {Elapsed:F0}s ago, 0 players connected",
                    roomCode, hostName, elapsed.TotalSeconds);

                // Notify any lingering connections (shouldn't be any, but just in case)
                await _hubContext.Clients.Group(roomCode).SendAsync("RoomClosed", "Room auto-closed due to inactivity");
            }

            timers.TryRemove(roomCode, out _);
        }
    }
}
