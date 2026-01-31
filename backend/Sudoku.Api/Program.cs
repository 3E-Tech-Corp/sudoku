using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Data.SqlClient;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Sudoku.Api.Hubs;
using Sudoku.Api.Services;
using Dapper;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Sudoku API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme.",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

// JWT Authentication
var jwtKey = builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("JWT Key not configured");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "Sudoku";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "Sudoku";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };

        // Allow SignalR to receive token from query string
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// CORS
var corsOrigins = builder.Configuration["Cors:Origins"]?.Split(',', StringSplitOptions.RemoveEmptyEntries) ?? Array.Empty<string>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Register services
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<SudokuGenerator>();
builder.Services.AddScoped<RoomService>();

var app = builder.Build();

// Auto-migration
using (var scope = app.Services.CreateScope())
{
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var connStr = config.GetConnectionString("DefaultConnection");
    if (!string.IsNullOrEmpty(connStr))
    {
        try
        {
            using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();

            // Users table (from template)
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
                BEGIN
                    CREATE TABLE Users (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        Username NVARCHAR(100) NOT NULL UNIQUE,
                        Email NVARCHAR(255) NOT NULL,
                        PasswordHash NVARCHAR(500) NOT NULL,
                        Role NVARCHAR(50) NOT NULL DEFAULT 'User',
                        IsActive BIT NOT NULL DEFAULT 1,
                        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                        UpdatedAt DATETIME2 NULL
                    );
                END");

            // SudokuPuzzles table
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SudokuPuzzles')
                BEGIN
                    CREATE TABLE SudokuPuzzles (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        Difficulty NVARCHAR(20) NOT NULL,
                        InitialBoard NVARCHAR(MAX) NOT NULL,
                        Solution NVARCHAR(MAX) NOT NULL,
                        CreatedAt DATETIME2 DEFAULT GETUTCDATE()
                    );
                END");

            // Rooms table
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Rooms')
                BEGIN
                    CREATE TABLE Rooms (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        Code NVARCHAR(10) NOT NULL UNIQUE,
                        PuzzleId INT NOT NULL,
                        HostName NVARCHAR(100),
                        Difficulty NVARCHAR(20) DEFAULT 'Medium',
                        Status NVARCHAR(20) DEFAULT 'Active',
                        CurrentBoard NVARCHAR(MAX),
                        PlayerColors NVARCHAR(MAX),
                        CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
                        CompletedAt DATETIME2 NULL
                    );
                END");

            // RoomMembers table
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RoomMembers')
                BEGIN
                    CREATE TABLE RoomMembers (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        RoomId INT NOT NULL,
                        DisplayName NVARCHAR(100) NOT NULL,
                        Color NVARCHAR(20) NOT NULL,
                        JoinedAt DATETIME2 DEFAULT GETUTCDATE()
                    );
                END");

            // Add Notes column to Rooms if missing
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Rooms') AND name = 'Notes')
                    ALTER TABLE Rooms ADD Notes NVARCHAR(MAX) NULL;");

            // Add IsPublic column to Rooms if missing
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Rooms') AND name = 'IsPublic')
                    ALTER TABLE Rooms ADD IsPublic BIT NOT NULL DEFAULT 0;");

            // Add Mode column to Rooms if missing
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Rooms') AND name = 'Mode')
                    ALTER TABLE Rooms ADD Mode NVARCHAR(20) NOT NULL DEFAULT 'Cooperative';");

            // CompetitiveBoards table
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CompetitiveBoards')
                BEGIN
                    CREATE TABLE CompetitiveBoards (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        RoomId INT NOT NULL,
                        PlayerName NVARCHAR(100) NOT NULL,
                        CurrentBoard NVARCHAR(MAX) NOT NULL,
                        Notes NVARCHAR(MAX) NULL,
                        FilledCount INT NOT NULL DEFAULT 0,
                        CompletedAt DATETIME2 NULL
                    );
                END");

            app.Logger.LogInformation("Database migration completed successfully");
        }
        catch (Exception ex)
        {
            app.Logger.LogWarning(ex, "Database migration failed - will retry on first request");
        }
    }
}

// Middleware pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<SudokuHub>("/hubs/sudoku");

app.Run();
