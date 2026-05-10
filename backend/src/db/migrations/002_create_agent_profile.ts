import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      capability_tags TEXT[] NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'offline',
      tool_ids UUID[] DEFAULT '{}'::uuid[],
      communication_endpoint VARCHAR(500) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT status_check CHECK (status IN ('ready', 'busy', 'offline')),
      CONSTRAINT name_unique UNIQUE (name)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON agent_profiles(status);
    CREATE INDEX IF NOT EXISTS idx_agent_profiles_capability_tags ON agent_profiles USING GIN(capability_tags);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS agent_profiles;
  `);
}

