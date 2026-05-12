import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  console.log('Running migration 010: Create authored eval set tables...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_sets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      default_system_prompt TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS eval_set_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      eval_set_id UUID NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      question TEXT NOT NULL,
      type TEXT NOT NULL,
      choices JSONB,
      correct_answer TEXT NOT NULL,
      match_type TEXT,
      category TEXT,
      origin TEXT NOT NULL DEFAULT 'human',
      generation_context JSONB,
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (eval_set_id, item_key)
    );

    CREATE INDEX IF NOT EXISTS idx_eval_set_items_eval_set_id ON eval_set_items(eval_set_id);

    ALTER TABLE eval_runs
      ADD COLUMN IF NOT EXISTS eval_set_id UUID REFERENCES eval_sets(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_eval_runs_eval_set_id ON eval_runs(eval_set_id);
  `);

  console.log('Migration 010 complete: eval_sets, eval_set_items, and eval_runs.eval_set_id created.');
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP INDEX IF EXISTS idx_eval_runs_eval_set_id;
    ALTER TABLE eval_runs DROP COLUMN IF EXISTS eval_set_id;
    DROP TABLE IF EXISTS eval_set_items;
    DROP TABLE IF EXISTS eval_sets;
  `);
}
