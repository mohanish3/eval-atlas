import { getPool } from '../connection.js';

export async function up(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_tool_relations (
      agent_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      tool_id UUID NOT NULL REFERENCES tool_definitions(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, tool_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_tool_relations_agent_id ON agent_tool_relations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tool_relations_tool_id ON agent_tool_relations(tool_id);
  `);
}

export async function down(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DROP TABLE IF EXISTS agent_tool_relations;
  `);
}

