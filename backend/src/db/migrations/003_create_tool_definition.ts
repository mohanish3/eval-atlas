import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tool_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL UNIQUE,
      domains TEXT[] NOT NULL,
      input_schema JSONB NOT NULL,
      output_schema JSONB,
      status VARCHAR(50) NOT NULL DEFAULT 'pending-validation',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT status_check CHECK (status IN ('active', 'pending-validation', 'disabled'))
    );

    CREATE INDEX IF NOT EXISTS idx_tool_definitions_status ON tool_definitions(status);
    CREATE INDEX IF NOT EXISTS idx_tool_definitions_domains ON tool_definitions USING GIN(domains);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS tool_definitions;
  `);
}

