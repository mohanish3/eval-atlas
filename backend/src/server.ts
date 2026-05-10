import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { checkDatabaseConnection } from './db/connection.js';
import { rateLimiter } from './middleware/rateLimiter.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const explicitCorsOrigins = process.env.CORS_ORIGIN;
const isProd = process.env.NODE_ENV === 'production';

// Security Headers
app.use(helmet());

const allowedOrigins = (explicitCorsOrigins || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isPrivateDevOrigin(origin: string): boolean {
  if (isProd || explicitCorsOrigins) {
    return false;
  }

  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    if (url.port !== '5173') {
      return false;
    }

    const host = url.hostname;
    return /^localhost$/i.test(host)
      || /^127(?:\.\d{1,3}){3}$/.test(host)
      || /^10(?:\.\d{1,3}){3}$/.test(host)
      || /^192\.168(?:\.\d{1,3}){2}$/.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(host);
  } catch {
    return false;
  }
}

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Allow non-browser and same-origin requests with no Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    if (isPrivateDevOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  },
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(rateLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_MAX || 120) }));

// Health check
app.get('/health', async (_req, res) => {
  const dbState = await checkDatabaseConnection();
  const showDetail = !isProd;

  res.status(dbState.connected ? 200 : 503).json({
    status: dbState.connected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      database: dbState.connected ? 'connected' : 'unavailable',
      evalStorage: dbState.connected ? 'database' : 'memory',
    },
    ...(dbState.error && showDetail ? { error: dbState.error } : {}),
  });
});

// API routes
import apiRoutes from './routes/index.js';
app.use('/api', apiRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  const { closePool } = await import('./db/connection.js');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  const { closePool } = await import('./db/connection.js');
  await closePool();
  process.exit(0);
});

