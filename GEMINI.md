# GEMINI.md

Project instructions for Gemini agents. Use [AGENTS.md](./AGENTS.md) as canonical repo guide.

## Priorities

1. Preserve security defaults. Never commit secrets.
2. Keep frontend and backend API shapes aligned.
3. Prefer incremental changes over broad refactors.
4. Sync agent docs when workflow or routes change.

## Commands

```bash
npm run build
npm run lint
npm run test
npm run migrate
```

Workspace commands:

```bash
cd backend && npm run dev
cd backend && npm test
cd frontend && npm run dev
cd frontend && npm run build
cd frontend && npm test
```

## Repo Facts

- Backend: Express + TypeScript + Postgres + in-memory fallback
- Frontend: React + Vite + TypeScript + Tailwind
- Realtime results: SSE from `/api/evals/runs/:id/stream`
- Authored eval sets persisted in `eval_sets` / `eval_set_items` or memory fallback
- Saved eval sets export to CSV in frontend

## Current Pages

- `/evals`
- `/evals/sets`
- `/evals/config`
- `/evals/builder/new`
- `/evals/builder/:evalSetId`
- `/evals/:id`

## Security

- Keep `.env` out of git
- Set `API_TOKEN` in production
- Set explicit `CORS_ORIGIN` in production
- Review DB TLS config before public deploy
- Gate mock provider with `MOCK_ENABLED`

## DB Env Notes

- Backend accepts `DATABASE_URL`, granular `DATABASE_*` fields, or `SUPABASE_*` fields for Postgres config.
- Optional `DATABASE_READ_URL` is used for read-only eval queries; primary writes still use main DB config.
