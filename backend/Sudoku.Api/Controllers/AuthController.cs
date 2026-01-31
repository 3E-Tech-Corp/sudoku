using System.Security.Claims;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Sudoku.Api.Models;
using Sudoku.Api.Services;

namespace Sudoku.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly AuthService _authService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(IConfiguration config, AuthService authService, ILogger<AuthController> logger)
    {
        _config = config;
        _authService = authService;
        _logger = logger;
    }

    private SqlConnection CreateConnection() =>
        new(_config.GetConnectionString("DefaultConnection"));

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        using var conn = CreateConnection();
        var user = await conn.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @Username AND IsActive = 1",
            new { request.Username });

        if (user == null || !_authService.VerifyPassword(request.Password, user.PasswordHash))
            return Unauthorized(new { message = "Invalid username or password" });

        var token = _authService.GenerateToken(user.Username, user.Role, user.Id);
        return Ok(new LoginResponse
        {
            Token = token,
            Username = user.Username,
            Role = user.Role,
            ExpiresAt = _authService.GetTokenExpiry(token)
        });
    }

    [HttpPost("register")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        using var conn = CreateConnection();
        var existing = await conn.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @Username", new { request.Username });

        if (existing != null)
            return Conflict(new { message = "Username already exists" });

        var passwordHash = _authService.HashPassword(request.Password);
        var id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO Users (Username, Email, PasswordHash, Role)
            OUTPUT INSERTED.Id
            VALUES (@Username, @Email, @PasswordHash, @Role)",
            new { request.Username, request.Email, PasswordHash = passwordHash, request.Role });

        _logger.LogInformation("User {Username} registered by {Admin}", request.Username, User.Identity?.Name);
        return Ok(new { id, request.Username, request.Email, request.Role });
    }

    [HttpPost("setup")]
    public async Task<IActionResult> Setup([FromBody] SetupRequest request)
    {
        using var conn = CreateConnection();
        var userCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Users");

        if (userCount > 0)
            return BadRequest(new { message = "Setup already completed. Use login instead." });

        var passwordHash = _authService.HashPassword(request.Password);
        var id = await conn.QuerySingleAsync<int>(@"
            INSERT INTO Users (Username, Email, PasswordHash, Role)
            OUTPUT INSERTED.Id
            VALUES (@Username, @Email, @PasswordHash, 'Admin')",
            new { request.Username, request.Email, PasswordHash = passwordHash });

        var token = _authService.GenerateToken(request.Username, "Admin", id);
        _logger.LogInformation("Initial admin {Username} created via setup", request.Username);

        return Ok(new LoginResponse
        {
            Token = token,
            Username = request.Username,
            Role = "Admin",
            ExpiresAt = _authService.GetTokenExpiry(token)
        });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        using var conn = CreateConnection();
        var user = await conn.QueryFirstOrDefaultAsync<UserDto>(
            "SELECT Id, Username, Email, Role, IsActive, CreatedAt FROM Users WHERE Id = @Id",
            new { Id = userId });

        if (user == null) return NotFound();
        return Ok(user);
    }

    [HttpGet("users")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Users()
    {
        using var conn = CreateConnection();
        var users = await conn.QueryAsync<UserDto>(
            "SELECT Id, Username, Email, Role, IsActive, CreatedAt FROM Users ORDER BY CreatedAt DESC");
        return Ok(users);
    }

    [HttpPut("users/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateUser(int id, [FromBody] UpdateUserRequest request)
    {
        using var conn = CreateConnection();
        var user = await conn.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Id = @Id", new { Id = id });

        if (user == null) return NotFound(new { message = "User not found" });

        if (request.Email != null)
            user.Email = request.Email;
        if (request.Role != null)
            user.Role = request.Role;
        if (request.IsActive.HasValue)
            user.IsActive = request.IsActive.Value;

        string? newPasswordHash = null;
        if (!string.IsNullOrEmpty(request.Password))
            newPasswordHash = _authService.HashPassword(request.Password);

        await conn.ExecuteAsync(@"
            UPDATE Users SET
                Email = @Email,
                Role = @Role,
                IsActive = @IsActive,
                PasswordHash = COALESCE(@NewPasswordHash, PasswordHash),
                UpdatedAt = GETUTCDATE()
            WHERE Id = @Id",
            new { user.Email, user.Role, user.IsActive, NewPasswordHash = newPasswordHash, Id = id });

        _logger.LogInformation("User {Id} updated by {Admin}", id, User.Identity?.Name);
        return Ok(new { message = "User updated" });
    }
}
