import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_memory_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      workflow_task_id UUID REFERENCES workflow_tasks(id) ON DELETE SET NULL,
      embedding_hash VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      metadata JSONB DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_shared_memory_records_agent_id ON shared_memory_records(agent_id);
    CREATE INDEX IF NOT EXISTS idx_shared_memory_records_workflow_task_id ON shared_memory_records(workflow_task_id);
    CREATE INDEX IF NOT EXISTS idx_shared_memory_records_embedding_hash ON shared_memory_records(embedding_hash);
    CREATE INDEX IF NOT EXISTS idx_shared_memory_records_timestamp ON shared_memory_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_shared_memory_records_metadata ON shared_memory_records USING GIN(metadata);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS shared_memory_records;
  `);
}

