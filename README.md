# Project Template

Full-stack project template for .NET 8 Web API + React/Vite/TypeScript applications deployed to IIS.

## 🚀 What's Included

### Backend (`backend/ProjectTemplate.Api/`)
- .NET 8 Web API
- Dapper + SQL Server
- JWT Authentication with PBKDF2 password hashing
- Auto-migration (creates Users table on startup)
- Auth endpoints: login, register, setup (bootstrap first admin), me, users
- Health check endpoint at `/health`
- Swagger UI in development

### Frontend (`frontend/`)
- React 18 + Vite + TypeScript
- Tailwind CSS
- JWT auth context with token management
- Dark-themed login page
- Sidebar layout with navigation
- Typed API service (`api.ts`)

### CI/CD (`.github/workflows/`)
- **build.yml** — Runs on PRs to main; builds both backend and frontend
- **deploy.yml** — Manual dispatch; builds, uploads artifacts, deploys to IIS via self-hosted runner

### Deployment (`Deployment/`)
- `deploy-iis.ps1` — Stops app pool → copies files → starts app pool → health check

## 🏗️ Using This Template

1. Create a new repo from this template
2. Replace placeholders in `backend/ProjectTemplate.Api/appsettings.json`:
   - `__CONNECTION_STRING__` — SQL Server connection string
   - `__JWT_KEY__` — JWT signing key (min 32 chars)
   - `__CORS_ORIGINS__` — Comma-separated allowed origins
3. Rename `ProjectTemplate` references to your project name
4. Set the `IIS_SITE_NAME` repository variable for deployments
5. Push and deploy!

## 📁 IIS Structure

```
F:\New_WWW\{site_name}\
├── WWW\          ← Frontend (site root)
└── API\          ← Backend (virtual app under /api)
```

## 🛠️ Local Development

### Backend
```bash
cd backend/ProjectTemplate.Api
dotnet run
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to the backend at `http://localhost:5000`.

## 🔐 First-Time Setup

After deployment, call `POST /api/auth/setup` with:
```json
{
  "username": "admin",
  "email": "admin@example.com",
  "password": "your-secure-password"
}
```

This bootstraps the first admin user. The endpoint is disabled after the first user is created.
