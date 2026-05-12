import { getPool } from '../connection.js';
import * as migration009 from './009_create_eval_tables.js';
import * as migration010 from './010_create_authored_eval_sets.js';

const migrations = [
  { name: '009_create_eval_tables', ...migration009 },
  { name: '010_create_authored_eval_sets', ...migration010 },
];

async function ensureMigrationsTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getAppliedMigrations(): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return result.rows.map((row) => row.version);
}

async function recordMigration(version: string): Promise<void> {
  const pool = getPool();
  await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const migration of migrations) {
    if (applied.includes(migration.name)) {
      console.log(`✓ Migration ${migration.name} already applied`);
      continue;
    }

    console.log(`Running migration ${migration.name}...`);
    try {
      await migration.up();
      await recordMigration(migration.name);
      console.log(`✓ Migration ${migration.name} completed`);
    } catch (error) {
      console.error(`✗ Migration ${migration.name} failed:`, error);
      throw error;
    }
  }

  console.log('All migrations completed successfully');
}

// When executed via `npm run migrate` (CLI usage), run all migrations.
runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

