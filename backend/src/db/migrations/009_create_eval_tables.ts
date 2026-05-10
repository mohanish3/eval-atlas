import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  console.log('Running migration 009: Create eval tables...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      system_prompt TEXT,
      eval_set_filename TEXT,
      eval_set_data JSONB NOT NULL,
      models_config JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS eval_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES eval_runs(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      category TEXT,
      model_output TEXT,
      correct_answer TEXT,
      is_correct BOOLEAN,
      error_type TEXT,
      latency_ms INTEGER,
      tokens_used INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_eval_results_run_id ON eval_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_eval_results_model_id ON eval_results(model_id);
  `);

  console.log('Migration 009 complete: eval_runs and eval_results tables created.');
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS eval_results;
    DROP TABLE IF EXISTS eval_runs;
  `);
}
