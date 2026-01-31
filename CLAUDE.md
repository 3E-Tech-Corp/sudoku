# CLAUDE.md — Project Context for AI Assistants

## Project Overview
This is a full-stack web application template: .NET 8 Web API backend + React/Vite/TypeScript frontend.
It's designed for deployment to IIS with a self-hosted GitHub Actions runner.

## Architecture
- **Backend:** `backend/ProjectTemplate.Api/` — .NET 8 minimal API with Dapper + SQL Server
- **Frontend:** `frontend/` — React 18 + Vite + TypeScript + Tailwind CSS
- **Deployment:** GitHub Actions → self-hosted runner → IIS

## Key Patterns
- Backend uses Dapper (not EF Core) for SQL Server access
- JWT authentication with PBKDF2 password hashing
- Auto-migration in Program.cs creates tables on startup
- Frontend uses a typed fetch wrapper (`src/services/api.ts`)
- AuthContext manages JWT tokens in localStorage
- IIS deployment: frontend at site root (`WWW/`), backend as virtual app (`API/` → `/api`)

## Deployment
- Physical paths: `F:\New_WWW\{site_name}\WWW` (frontend) + `F:\New_WWW\{site_name}\API` (backend)
- Deploy script: `Deployment/deploy-iis.ps1` (stop pool → copy → start pool → health check)
- Health endpoint: `GET /health` returns 200

## Configuration Placeholders (appsettings.json)
- `__CONNECTION_STRING__` — SQL Server connection string
- `__JWT_KEY__` — JWT signing key (min 32 characters)
- `__CORS_ORIGINS__` — Comma-separated allowed CORS origins

## Build Commands
```bash
# Backend
cd backend/ProjectTemplate.Api && dotnet build

# Frontend
cd frontend && npm install && npm run build
```

## Important Notes
- The `/api/auth/setup` endpoint only works when 0 users exist (bootstrap admin)
- All auth endpoints except login and setup require JWT Bearer token
- Register endpoint requires Admin role
- CORS origins are configured in appsettings, not hardcoded
