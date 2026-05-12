# Eval Atlas

Eval Atlas run prompt/model eval sets from browser. Repo contains only eval app:

- `backend/` Express + TypeScript API, SSE, Postgres persistence
- `frontend/` React + Vite dashboard
- `docker-compose.yml` local Postgres 16
- `start-all.ps1` / `start-all.sh` startup scripts

## Requirements

- Node.js 20+
- npm 10+
- Docker Desktop for repo-managed Postgres, or existing PostgreSQL 16+

## Quick Start

1. Copy env templates:
   - PowerShell:
     - `Copy-Item .env.example .env`
     - `Copy-Item backend/.env.example backend/.env`
     - `Copy-Item frontend/.env.example frontend/.env`
   - Bash:
     - `cp .env.example .env`
     - `cp backend/.env.example backend/.env`
     - `cp frontend/.env.example frontend/.env`
2. Set strong `POSTGRES_PASSWORD` in root `.env`.
3. Optional but recommended: set strong `API_TOKEN` in `backend/.env`.
4. Start all:
   - PowerShell: `./start-all.ps1`
   - Bash: `./start-all.sh`
5. Open `http://localhost:5173`.

## Startup Script Behavior

- Root `.env` is source of truth for local Postgres creds.
- Scripts auto-sync `backend/.env` `DATABASE_URL` from root `.env`.
- If Docker engine down, scripts warn and skip `docker compose`.
- If DB unreachable, placeholder password still used, or DB auth fails, scripts skip migrations and backend start.
- If ports already in use, scripts reuse existing backend/frontend instead of crashing.
- If dependency install already healthy, scripts skip reinstall.

Flags:

- PowerShell: `-SkipDocker`, `-SkipInstall`, `-SkipMigrate`
- Bash: `--skip-docker`, `--skip-install`, `--skip-migrate`

## Environment

Root `.env`:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me
POSTGRES_DB=eval_atlas
POSTGRES_PORT=5432
```

Important backend vars in `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:your-password@localhost:5432/eval_atlas
DATABASE_READ_URL=
DATABASE_HOST=
DATABASE_PORT=5432
DATABASE_NAME=
DATABASE_USER=
DATABASE_PASSWORD=
DATABASE_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=true
SUPABASE_PROJECT_REF=
SUPABASE_DB_PASSWORD=
SUPABASE_REGION=
SUPABASE_USE_POOLER=false
SUPABASE_DB_NAME=postgres
PORT=3000
API_TOKEN=
CORS_ORIGIN=http://localhost:5173
RATE_LIMIT_MAX=120
MAX_EVAL_FILE_BYTES=5242880
```

DB config precedence:

- `DATABASE_URL`
- `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD`
- `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` with optional `SUPABASE_REGION` and `SUPABASE_USE_POOLER=true`
- `DATABASE_READ_URL` optional read replica for read-only eval queries

Optional provider keys:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `TOGETHER_API_KEY`

If no cloud keys set, local smoke tests still work with mock provider.

## Security Defaults

- `.env`, `backend/.env`, `frontend/.env` ignored by git.
- Common key/cert files ignored: `*.pem`, `*.key`, `*.crt`, `*.p12`.
- Backend rate limiting enabled.
- Backend CORS restricted to configured origins. Default only allows local Vite origins.
- If `API_TOKEN` set, all `/api` routes including SSE stream require token.
- Uploads capped by `MAX_EVAL_FILE_BYTES` to reduce memory abuse.

## Push Checklist

Before push:

1. Confirm no real secrets in tracked files.
2. Keep only `.env.example` files in git, never real `.env`.
3. Set placeholder values only in examples.
4. Verify backend and frontend builds pass.
5. Verify `npm audit --omit=dev` clean in both `backend/` and `frontend/`.
6. If exposing outside localhost, set `API_TOKEN`, narrow `CORS_ORIGIN`, use strong DB creds, run TLS/proxy in front.

## Verification Commands

```powershell
cd backend
npm ci
npm run build
npm test
npm audit --omit=dev

cd ../frontend
npm ci
npm run build
npm audit --omit=dev
```

## Notes

- Backend needs working Postgres before API routes function fully.
- Frontend can still build and run without DB, but live eval features need backend.
- If Docker Desktop off, start it or point repo to existing local Postgres.
