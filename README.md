# Eval Atlas

Run multiple-choice and open-ended eval sets against LLM prompts from a browser dashboard, with per-category accuracy breakdown. No notebook or CLI required.

Upload a JSON or JSONL eval set, pick a provider, run it, and see pass/fail per question plus category-level accuracy.

## Example eval item

```json
{
  "id": "q_001",
  "question": "What is the primary purpose of a PRD?",
  "type": "multiple_choice",
  "choices": {
    "A": "To track bugs",
    "B": "To describe what a product should do and why",
    "C": "To manage the sprint backlog",
    "D": "To document sales performance"
  },
  "correct_answer": "B",
  "category": "product-management"
}
```

Full format reference: [docs/eval-format.md](docs/eval-format.md). Sample 20-question set: [docs/sample-eval-set.json](docs/sample-eval-set.json). Upload it directly from the New Run form to try the dashboard without writing your own set first.

## Stack

- `backend/`: Express + TypeScript API, SSE streaming, Postgres persistence
- `frontend/`: React + Vite dashboard
- `docker-compose.yml`: local Postgres 16

## Requirements

- Node.js 20+, npm 10+
- Docker Desktop for the repo-managed Postgres, or an existing PostgreSQL 16+ instance

## Quickstart

1. Copy env templates:

   PowerShell: `Copy-Item .env.example .env`, `Copy-Item backend/.env.example backend/.env`, `Copy-Item frontend/.env.example frontend/.env`

   Bash: `cp .env.example .env`, `cp backend/.env.example backend/.env`, `cp frontend/.env.example frontend/.env`

2. Set a strong `POSTGRES_PASSWORD` in the root `.env`.
3. Optional, recommended: set a strong `API_TOKEN` in `backend/.env`.
4. Start everything: PowerShell `./start-all.ps1`, Bash `./start-all.sh`
5. Open `http://localhost:5173`.

Flags: PowerShell `-SkipDocker`, `-SkipInstall`, `-SkipMigrate` · Bash `--skip-docker`, `--skip-install`, `--skip-migrate`

Startup script behavior: root `.env` is the source of truth for local Postgres credentials and is synced into `backend/.env` automatically. If Docker is down, the script skips `docker compose` and warns. If ports are already in use, it reuses the existing backend/frontend instead of failing. If dependencies are already installed, it skips reinstall.

## Environment

Root `.env`:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me
POSTGRES_DB=eval_atlas
POSTGRES_PORT=5432
```

`backend/.env` accepts a direct `DATABASE_URL`, discrete `DATABASE_HOST`/`PORT`/`NAME`/`USER`/`PASSWORD`, or Supabase connection fields (`SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`, optional `SUPABASE_REGION`/`SUPABASE_USE_POOLER`), checked in that precedence order. Optional read replica via `DATABASE_READ_URL`.

Model provider keys (all optional; without any set, local smoke tests run against a mock provider): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `TOGETHER_API_KEY`.

## Security defaults

- `.env` files are git-ignored; only `.env.example` templates are tracked.
- Key/cert files ignored: `*.pem`, `*.key`, `*.crt`, `*.p12`.
- Rate limiting enabled on the backend.
- CORS restricted to configured origins, defaulting to local Vite origins only.
- If `API_TOKEN` is set, all `/api` routes including the SSE stream require it.
- Upload size capped by `MAX_EVAL_FILE_BYTES`.

Before exposing outside localhost: set `API_TOKEN`, narrow `CORS_ORIGIN`, use strong DB credentials, and run TLS/a proxy in front.

## Verification

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

- The backend needs a working Postgres connection before API routes function fully.
- The frontend builds and runs without a DB, but live eval features need the backend.
