import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  
  // Add workflow_type column
  await pool.query(`
    ALTER TABLE workflow_tasks 
    ADD COLUMN IF NOT EXISTS workflow_type VARCHAR(100) DEFAULT 'chat';
  `);

  // Drop old constraint and add new one to allow 'active', 'awaiting_input' etc.
  // Actually, removing the check constraint gives more flexibility for the state machine statuses
  await pool.query(`
    ALTER TABLE workflow_tasks 
    DROP CONSTRAINT IF EXISTS status_check;
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    ALTER TABLE workflow_tasks 
    DROP COLUMN IF EXISTS workflow_type;
  `);
}