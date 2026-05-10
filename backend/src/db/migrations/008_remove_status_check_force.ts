import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  console.log('Running migration 008: Force removing status_check constraint...');
  
  try {
    // Force drop the constraint again to be sure
    await pool.query(`
      ALTER TABLE workflow_tasks 
      DROP CONSTRAINT IF EXISTS status_check;
    `);
    console.log('Successfully dropped status_check constraint (if it existed).');
  } catch (error) {
    console.error('Error dropping status_check constraint:', error);
    throw error;
  }
}

export async function down(): Promise<void> {
  // No-op: We don't want to restore the restrictive constraint
}
