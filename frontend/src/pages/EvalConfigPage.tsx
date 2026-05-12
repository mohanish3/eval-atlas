import { Database, Link2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { useEvalStore } from '../store/useEvalStore';

const DATABASE_INTEGRATIONS = [
  {
    name: 'Local Postgres / Docker',
    badge: 'Primary',
    description: 'Store root or backend env vars, backend builds connection later and persists runs/eval sets there.',
    url: `DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=eval_atlas
DATABASE_USER=postgres
DATABASE_PASSWORD=[YOUR-PASSWORD]
DATABASE_SSL=false`,
    note: 'Good for Docker compose, native local Postgres, or VM-hosted Postgres on trusted network.',
  },
  {
    name: 'Supabase Direct',
    badge: 'Native',
    description: 'Backend derives DATABASE_URL from exact Supabase fields. No manual string assembly needed.',
    url: `SUPABASE_PROJECT_REF=[YOUR-PROJECT-REF]
SUPABASE_DB_PASSWORD=[YOUR-DATABASE-PASSWORD]
SUPABASE_USE_POOLER=false
SUPABASE_DB_NAME=postgres`,
    note: 'Builds postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require.',
  },
  {
    name: 'Supabase Transaction Pooler',
    badge: 'Native',
    description: 'Use pooled Supabase host for API bursts. Region required because pooler hostname includes it.',
    url: `SUPABASE_PROJECT_REF=[YOUR-PROJECT-REF]
SUPABASE_DB_PASSWORD=[YOUR-DATABASE-PASSWORD]
SUPABASE_REGION=[YOUR-REGION]
SUPABASE_USE_POOLER=true
SUPABASE_DB_NAME=postgres`,
    note: 'Builds postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require.',
  },
  {
    name: 'External Postgres URL',
    badge: 'External',
    description: 'Fast path for Neon, RDS, Railway, Render, Azure, Crunchy, Timescale, self-hosted managed Postgres.',
    url: `DATABASE_URL=postgresql://[USER]:[PASSWORD]@[HOST]:5432/[DATABASE]?sslmode=require
DB_SSL_REJECT_UNAUTHORIZED=true`,
    note: 'Use provider-issued URL exactly when provider already gives full Postgres URI.',
  },
  {
    name: 'Generic Host / Port / User / Password',
    badge: 'External',
    description: 'Use explicit fields when secret manager injects host/user/pass separately instead of one URI.',
    url: `DATABASE_HOST=[HOST]
DATABASE_PORT=5432
DATABASE_NAME=[DATABASE]
DATABASE_USER=[USER]
DATABASE_PASSWORD=[PASSWORD]
DATABASE_SSL=true`,
    note: 'Backend assembles and uses DATABASE_URL from these env vars at runtime.',
  },
  {
    name: 'Read Replica / Analytics URL',
    badge: 'Replica',
    description: 'Optional read-only endpoint for listing runs/results/sets while writes still go to primary DB.',
    url: `DATABASE_READ_URL=postgresql://[USER]:[PASSWORD]@[READ-HOST]:5432/[DATABASE]?sslmode=require`,
    note: 'Used later for read queries in run and eval-set pages. Writes still use primary DB config.',
  },
] as const;

export default function EvalConfigPage() {
  const { runtimeStatus } = useEvalStore();
  const fallbackMode = runtimeStatus.storageMode === 'memory';
  const databaseConfig = runtimeStatus.databaseConfig;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                  <Database className="h-5 w-5 text-cyan-200" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">Database configuration</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                  Keep integration patterns here. Main evals page stays focused on running benchmarks and browsing results.
                </p>
              </div>
              <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-200">
                {fallbackMode ? 'Memory fallback active' : 'Database persistence active'}
              </Badge>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Runtime mode</p>
                <p className="mt-3 text-lg font-semibold text-slate-100">{fallbackMode ? 'Memory fallback' : 'Persistent database'}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {fallbackMode ? 'Runs and sets last for current server session only.' : 'Runs and authored sets persist in Postgres.'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Env vars</p>
                <p className="mt-3 font-mono text-sm text-slate-100">Root `.env` or `backend/.env`</p>
                <p className="mt-1 text-sm text-slate-400">Backend reads `DATABASE_URL`, `DATABASE_*`, `SUPABASE_*`, and optional `DATABASE_READ_URL`.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Backend source</p>
                <p className="mt-3 text-sm text-slate-100">{databaseConfig?.label ?? 'Unknown'}</p>
                <p className="mt-1 text-sm text-slate-400">{databaseConfig?.configured ? 'Config resolved from env and used by backend pool.' : 'No DB env config resolved yet.'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-slate-100">Active backend config</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Redacted runtime state from backend. Confirms env config was loaded and later used by database pool creation.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-5">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Resolved env keys</p>
                <p className="mt-3 text-sm text-slate-100">
                  {databaseConfig?.envKeys.length ? databaseConfig.envKeys.join(', ') : 'None'}
                </p>
                <p className="mt-3 text-xs text-slate-400">
                  SSL: {databaseConfig?.sslEnabled ? 'enabled' : 'disabled'} | Read replica: {databaseConfig?.readReplicaConfigured ? 'configured' : 'not configured'}
                </p>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-5">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Resolved connection</p>
                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/80 p-3 font-mono text-xs text-slate-300">
                  {databaseConfig?.connectionString ?? 'No connection string resolved'}
                </div>
                <p className="mt-3 text-xs text-slate-400">Last runtime error: {runtimeStatus.databaseError ?? 'None exposed'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-slate-100">Connection patterns</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Set one env pattern below. Backend resolves it into connection config, then uses it for persistence and read queries.
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {DATABASE_INTEGRATIONS.map((integration) => (
                <div key={integration.name} className="rounded-[1.4rem] border border-white/10 bg-slate-950/40 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{integration.name}</div>
                      <p className="mt-2 text-sm text-slate-400">{integration.description}</p>
                    </div>
                    <Badge className="rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      {integration.badge}
                    </Badge>
                  </div>

                  <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/80 p-3 font-mono text-xs text-slate-300">
                    {integration.url}
                  </div>

                  <div className="mt-3 flex items-start gap-2 text-xs text-slate-400">
                    <Link2 className="mt-0.5 h-3.5 w-3.5 text-slate-500" />
                    <span>{integration.note}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
