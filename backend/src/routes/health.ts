import { Router } from 'express';
import { checkDatabaseConnection } from '../db/connection.js';

const router = Router();

router.get('/', async (_req, res) => {
  const start = Date.now();
  const dbState = await checkDatabaseConnection();
  res.status(dbState.connected ? 200 : 503).json({
    status: dbState.connected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      database: dbState.connected ? 'connected' : 'unavailable',
      evalStorage: dbState.connected ? 'database' : 'memory',
    },
    latencyMs: Date.now() - start,
    ...(dbState.error ? { error: dbState.error } : {}),
  });
});

export default router;
