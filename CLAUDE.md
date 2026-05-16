# CLAUDE.md

Guidance for Claude Code in this repo. Read [AGENTS.md](./AGENTS.md) first. This file only adds Claude-specific expectations.

## Claude Focus

- Prefer small, reviewable patches.
- Verify with build or targeted test before handoff when practical.
- Do not rewrite unrelated dirty files. Repo may already contain user changes.
- When updating docs, keep `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` aligned.

## Fast Path

From repo root:

```bash
npm run build
npm run lint
npm run test
npm run migrate
```

Dev servers:

```bash
./start-all.ps1
./start-all.sh
cd backend && npm run dev
cd frontend && npm run dev
```

## Current UI Surfaces

- `/evals` run dashboard
- `/evals/sets` saved eval sets + CSV export
- `/evals/config` database configuration notes
- `/evals/builder/new` create eval set
- `/evals/builder/:evalSetId` edit eval set
- `/evals/:id` run results

## Current Backend Surfaces

- `POST /api/evals/runs`
- `GET /api/evals/runs`
- `GET /api/evals/runs/:id`
- `POST /api/evals/runs/:id/retry-errors`
- `GET /api/evals/sets`
- `GET /api/evals/sets/:id`
- `POST /api/evals/sets`
- `PUT /api/evals/sets/:id`
- `DELETE /api/evals/sets/:id`
- `POST /api/evals/sets/:id/generate`
- `GET /api/evals/models`

## Note

`AGENTS.md` is canonical. If this file conflicts, update both and keep `AGENTS.md` source-of-truth.

## Docs

- `docs/autoresearch-evals-prd.md` covers Karpathy-style auto research for prompt optimization on eval runs.

## DB Env Notes

- Backend can read `DATABASE_URL`, granular `DATABASE_*` fields, or `SUPABASE_*` fields to build Postgres connection config.
- Optional `DATABASE_READ_URL` may serve read-only eval queries while writes still use primary DB.
