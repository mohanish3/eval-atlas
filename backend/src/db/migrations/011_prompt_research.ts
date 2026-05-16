import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  console.log('Running migration 011: Create prompt research tables...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_research_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      eval_run_id UUID REFERENCES eval_runs(id),
      source_eval_set_id UUID REFERENCES eval_sets(id),
      eval_set_data JSONB NOT NULL DEFAULT '[]',
      base_prompt TEXT NOT NULL,
      best_prompt TEXT,
      research_spec TEXT NOT NULL,
      research_model_provider TEXT NOT NULL,
      research_model_id TEXT NOT NULL,
      target_models_config JSONB NOT NULL,
      optimization_metric TEXT NOT NULL DEFAULT 'accuracy',
      status TEXT NOT NULL DEFAULT 'queued',
      storage_mode TEXT NOT NULL DEFAULT 'memory',
      max_iterations INTEGER NOT NULL DEFAULT 10,
      candidate_count_per_iteration INTEGER NOT NULL DEFAULT 2,
      sample_size INTEGER,
      holdout_enabled BOOLEAN NOT NULL DEFAULT true,
      early_stop_k INTEGER NOT NULL DEFAULT 10,
      max_token_budget INTEGER,
      baseline_accuracy NUMERIC,
      best_accuracy NUMERIC,
      promoted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS prompt_research_trials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      research_run_id UUID NOT NULL REFERENCES prompt_research_runs(id) ON DELETE CASCADE,
      iteration INTEGER NOT NULL,
      candidate_prompt TEXT NOT NULL,
      mutation_summary TEXT,
      status TEXT NOT NULL,
      overall_accuracy NUMERIC,
      latency_ms_avg NUMERIC,
      tokens_used_total INTEGER,
      runtime_error_count INTEGER,
      target_run_snapshot JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_research_trials_run_id ON prompt_research_trials(research_run_id);
  `);

  console.log('Migration 011 complete: prompt_research tables created.');
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS prompt_research_trials;
    DROP TABLE IF EXISTS prompt_research_runs;
  `);
}
