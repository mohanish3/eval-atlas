# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

From repo root:
```bash
npm run build       # tsc backend + vite frontend
npm run lint        # eslint both workspaces
npm run test        # jest (backend only)
npm run migrate     # run DB migrations
```

From `backend/`:
```bash
npm run dev         # tsx watch — hot reload, no build needed
npm test            # all jest tests
npm test -- --testPathPattern=scorer   # single test file
npm run test:coverage
npm run lint:fix
```

From `frontend/`:
```bash
npm run dev         # vite dev server (port 5173)
npm run build       # production build
```

Start everything together:
```bash
./start-all.sh          # bash
./start-all.ps1         # PowerShell
```
Both scripts auto-sync `DATABASE_URL` from root `.env`, start Docker Postgres, run migrations, then start backend and frontend.

## Architecture

### Overview

```
frontend (Vite/React :5173)
    └── REST + SSE ──► backend (Express :3000)
                           ├── Postgres (via docker-compose :5432)
                           └── fallbackStore (in-memory if DB down)
```

### Backend (`backend/src/`)

**Request flow for a new eval run:**
1. `POST /api/evals/runs` (multipart) — `routes/evals.ts`
2. File parsed and validated by `evalSchema.ts` (Zod)
3. Run record stored in Postgres or `fallbackStore.ts` if DB unavailable
4. `runner.ts#runEval()` fires asynchronously
5. Runner fans out to provider adapters in `evals/adapters/`
6. Each question result is scored by `scorer.ts` then broadcast via `sseManager.ts`
7. Frontend consumes `GET /api/evals/runs/:id/stream` (SSE)

**Storage duality:** `storageMode` is determined per-request by checking DB connectivity. Both paths (`database` and `memory`) produce identical API shapes. Memory runs are lost on restart.

**Adapters (`evals/adapters/`):** Each file exports a `ModelAdapter = (modelId, req: EvalRequest) => Promise<EvalResponse>`. API models run in parallel via `Promise.allSettled`; `local` (llama.cpp at `AGENT_URL`) and `ollama` models run sequentially.

**Canonical types:** `shared/evalTypes.ts` is the single source of truth for eval domain types. `shared/types.ts` holds legacy orchestration hub types (not used by the eval feature).

**Key env vars:**
- `DATABASE_URL` — Postgres connection string
- `API_TOKEN` — if set, all `/api` routes require `Authorization: Bearer <token>`
- `CORS_ORIGIN` — explicit frontend origin(s) for production
- `DB_SSL_REJECT_UNAUTHORIZED` — set 'false' to allow self-signed DB certs in prod (default 'true')
- `MOCK_ENABLED` — set 'true' to enable the mock provider
- `AGENT_URL` — llama.cpp server (default `http://localhost:3001`)
- `OLLAMA_URL` — Ollama server (default `http://localhost:11434`)
- `MAX_EVAL_FILE_BYTES` — upload cap (default 5 MB)

### Frontend (`frontend/src/`)

Two pages:
- `/evals` — run list + new run form (`pages/EvalsDashboard`)
- `/evals/:id` — live results with SSE consumer + comparison table (`pages/EvalResults`)

### Database

Migrations in `backend/src/db/migrations/` are numbered sequentially (`001_`, `002_`, …). Run `npm run migrate` (or the startup script) to apply all pending ones. The eval feature uses `eval_runs` and `eval_results` tables (migration `009`).

### Adding a New Provider

1. Create `backend/src/evals/adapters/<provider>.ts` implementing `ModelAdapter`
2. Register it in `runner.ts` `getAdapter()` switch
3. Add to the `providerConfig` array in `routes/evals.ts` (for the `/api/evals/models` endpoint)

### Scoring Logic (`evals/scorer.ts`)

- **Multiple choice:** extracts first A–D letter from model output (start of response, then anywhere as fallback)
- **Open-ended:** uses `match_type` field — `contains` (default), `exact`, or `regex` — all case-insensitive
- `runtime_error` results (adapter threw) can be retried via `POST /api/evals/runs/:id/retry-errors`

## Eval File Format

Upload `.json` (array) or `.jsonl` (one object per line). See `docs/eval-format.md` for full schema. Sample at `docs/sample-eval-set.json`.
