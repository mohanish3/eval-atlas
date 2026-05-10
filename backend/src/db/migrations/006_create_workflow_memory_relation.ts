import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  // This migration ensures workflow_tasks.shared_memory_ids is properly indexed
  // The column already exists from migration 001, but we add a GIN index for array queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_tasks_shared_memory_ids 
    ON workflow_tasks USING GIN(shared_memory_ids);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP INDEX IF EXISTS idx_workflow_tasks_shared_memory_ids;
  `);
}

