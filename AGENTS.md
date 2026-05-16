# AGENTS.md

Canonical repo guide for coding agents working in Eval Atlas.

## Mission

Eval Atlas is browser-based eval runner + authored eval set manager.

- Backend: Express + TypeScript API, SSE, Postgres persistence, memory fallback
- Frontend: React + Vite dashboard
- Main flows:
  - upload eval file, run models, inspect results
  - create/edit saved eval sets in UI
  - generate new rows from seed rows
  - export saved eval sets to CSV

## Repo Layout

```text
backend/   Express API, runner, adapters, DB, migrations
frontend/  React app, routes, UI, API client
docs/      specs and examples
```

Important files:

- `backend/src/routes/evals.ts` main eval API surface
- `backend/src/evals/runner.ts` run orchestration
- `backend/src/evals/scorer.ts` answer grading
- `backend/src/evals/fallbackStore.ts` in-memory fallback
- `backend/src/shared/evalTypes.ts` canonical eval domain types
- `frontend/src/services/api.ts` frontend API client + eval-set CSV export helper
- `frontend/src/pages/EvalsDashboard.tsx` run dashboard
- `frontend/src/pages/EvalSetsPage.tsx` saved eval sets page
- `frontend/src/pages/EvalConfigPage.tsx` DB config page
- `frontend/src/pages/EvalSetBuilder.tsx` spreadsheet-style builder
- `frontend/src/pages/EvalResults.tsx` run results
- `docs/autoresearch-evals-prd.md` product requirements for Karpathy-style prompt research on eval runs

## Commands

Repo root:

```bash
npm run build
npm run lint
npm run test
npm run migrate
```

Backend:

```bash
cd backend
npm run dev
npm run build
npm test
npm run test:coverage
npm run lint
npm run migrate
```

Frontend:

```bash
cd frontend
npm run dev
npm run build
npm run lint
npm test
```

Full local startup:

```bash
./start-all.ps1
./start-all.sh
```

Scripts sync root `.env` DB settings into backend env, optionally start Docker Postgres, run migrations, then start backend + frontend.

## Current Routes

Frontend routes:

- `/evals` run dashboard
- `/evals/sets` saved eval sets
- `/evals/config` database config guidance
- `/evals/builder/new` create eval set
- `/evals/builder/:evalSetId` edit eval set
- `/evals/:id` run results

Backend eval routes:

- `GET /api/evals/models`
- `GET /api/evals/runs`
- `POST /api/evals/runs`
- `GET /api/evals/runs/:id`
- `GET /api/evals/runs/:id/stream`
- `POST /api/evals/runs/:id/retry-errors`
- `GET /api/evals/sets`
- `GET /api/evals/sets/:id`
- `POST /api/evals/sets`
- `PUT /api/evals/sets/:id`
- `DELETE /api/evals/sets/:id`
- `POST /api/evals/sets/:id/generate`

## Architecture

Request path for eval run:

1. Frontend sends file upload, saved eval set id, or inline eval items to `POST /api/evals/runs`.
2. Backend validates payload in `evalSchema.ts`.
3. Run persisted to Postgres or `fallbackStore.ts` if DB unavailable.
4. `runner.ts` dispatches model calls.
5. `scorer.ts` grades outputs.
6. Results stream over SSE to frontend.

Authored eval set path:

1. Frontend builder edits `AuthoredEvalItem[]`.
2. `POST/PUT /api/evals/sets` stores set in DB or memory fallback.
3. `POST /api/evals/sets/:id/generate` expands rows from seed examples.
4. `/evals/sets` can reopen builder or export set as CSV.

## Storage Model

Storage mode resolved per request:

- `database`: Postgres available
- `memory`: fallback when DB unavailable

Both paths should return same API shape. Memory data lost on restart.

Relevant tables:

- `eval_runs`
- `eval_results`
- `eval_sets`
- `eval_set_items`

Migration `010_create_authored_eval_sets.ts` adds authored eval set tables and `eval_runs.eval_set_id`.

## Environment

Important backend env vars:

- `DATABASE_URL`
- `DATABASE_READ_URL`
- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_SSL`
- `API_TOKEN`
- `CORS_ORIGIN`
- `DB_SSL_REJECT_UNAUTHORIZED`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_REGION`
- `SUPABASE_USE_POOLER`
- `SUPABASE_DB_NAME`
- `MOCK_ENABLED`
- `AGENT_URL`
- `OLLAMA_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `TOGETHER_API_KEY`
- `MAX_EVAL_FILE_BYTES`
- `EVAL_SET_GENERATION_MODEL`

## Guardrails

- Never commit real secrets or `.env` files.
- Do not revert unrelated user changes in dirty worktree.
- Keep backend types and frontend API expectations aligned.
- Prefer targeted fixes over broad refactors.
- If changing workflow/docs/routes, update `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` together.
- Preserve fallback behavior. DB-down path is product feature, not temporary hack.

## Testing Expectations

- UI-only change: at least `cd frontend && npm run build`
- Backend-only change: at least `cd backend && npm run build`
- Cross-cutting API/UI change: prefer root `npm run build`
- Run targeted tests when touching scoring, parsing, migrations, or route behavior

## Common Change Patterns

Add new model provider:

1. Add adapter in `backend/src/evals/adapters/`
2. Register in `runner.ts`
3. Add provider metadata in `routes/evals.ts` `providerConfig`

Add new authored eval field:

1. Update `backend/src/shared/evalTypes.ts`
2. Update `backend/src/evals/evalSchema.ts`
3. Update DB persistence in `routes/evals.ts` and/or migrations
4. Update builder UI and `frontend/src/services/api.ts`
5. Verify CSV export if field should be included

Add new page:

1. Add page component under `frontend/src/pages/`
2. Register route in `frontend/src/App.tsx`
3. Expose navigation in `frontend/src/components/layout/Header.tsx` if user-facing

## Source Of Truth

`AGENTS.md` is canonical. `CLAUDE.md` and `GEMINI.md` are lightweight agent-specific mirrors and should stay in sync.
