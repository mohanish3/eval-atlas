import pg from 'pg';
import dotenv from 'dotenv';
import { resolveDatabaseConfig, resolveReadDatabaseUrl } from './config.js';

dotenv.config();

const { Pool } = pg;

let pool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;

function buildPool(connectionString: string, sslEnabled: boolean, rejectUnauthorized: boolean): pg.Pool {
  return new Pool({
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  });
}

export function getPool(): pg.Pool {
  if (!pool) {
    const databaseConfig = resolveDatabaseConfig();
    if (!databaseConfig.connectionString) {
      throw new Error('Database env vars are missing. Set DATABASE_URL or supported database field env vars.');
    }

    pool = buildPool(
      databaseConfig.connectionString,
      databaseConfig.sslEnabled,
      databaseConfig.rejectUnauthorized
    );

    pool.on('error', (err) => {
      console.error('Unexpected error on idle pg client - pool will be reset:', err.message);
      pool = null;
    });
  }

  return pool;
}

export function getReadPool(): pg.Pool {
  if (!readPool) {
    const databaseConfig = resolveDatabaseConfig();
    const readConfig = resolveReadDatabaseUrl();
    if (!readConfig.connectionString) {
      throw new Error('Read database env vars are missing. Set DATABASE_READ_URL or primary database config.');
    }

    readPool = buildPool(
      readConfig.connectionString,
      databaseConfig.sslEnabled,
      databaseConfig.rejectUnauthorized
    );

    readPool.on('error', (err) => {
      console.error('Unexpected error on idle read pg client - pool will be reset:', err.message);
      readPool = null;
    });
  }

  return readPool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (readPool) {
    await readPool.end();
    readPool = null;
  }
}

export async function checkDatabaseConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const activePool = getPool();
    await activePool.query('SELECT 1');
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

export { resolveDatabaseConfig };
