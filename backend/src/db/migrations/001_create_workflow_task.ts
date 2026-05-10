import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      operator_id VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      selected_agent_ids UUID[] NOT NULL,
      tool_invocations JSONB DEFAULT '[]'::jsonb,
      shared_memory_ids UUID[] DEFAULT '{}'::uuid[],
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      final_response TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT status_check CHECK (status IN ('pending', 'in-progress', 'complete', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_tasks_operator_id ON workflow_tasks(operator_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_tasks_created_at ON workflow_tasks(created_at);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS workflow_tasks;
  `);
}

