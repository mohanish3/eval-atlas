# Eval Atlas - Project Instructions

## Tech Stack
- **Backend:** Node.js (Express), TypeScript, Knex.js (Postgres), Jest.
- **Frontend:** React (Vite), TypeScript, Tailwind CSS, Playwright.

## Security Mandates
- **No Secrets:** Never commit `.env`, API keys, or credentials.
- **API Protection:** Set `API_TOKEN` in production.
- **CORS:** Set explicit `CORS_ORIGIN` in production.
- **DB Security:** Fix Postgres TLS (`rejectUnauthorized`) before production deploy.
- **Mock Gating:** Gate Mock provider via `MOCK_ENABLED` in production.

## Development Workflow
- **Backend:** `cd backend && npm install`
- **Frontend:** `cd frontend && npm install`
- **Audit:** Run `npm audit` frequently in `backend/`.
- **Migrations:** Use Knex migrations for DB schema changes.

## Testing
- **Backend:** `npm test`
- **Frontend:** `npm run test:e2e` (Playwright)
