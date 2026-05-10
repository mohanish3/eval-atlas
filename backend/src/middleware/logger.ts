import { Request, Response, NextFunction } from 'express';
import { getLoggingConfig, redactMetadata, shouldLog, LogLevel } from '../config/logging.js';

function writeLog(level: LogLevel, message: string, metadata?: Record<string, unknown>, error?: Error) {
  if (!shouldLog(level)) {
    return;
  }

  const sanitizedMetadata = redactMetadata(metadata);
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizedMetadata,
    ...(error
      ? {
          error: error.message,
          stack: getLoggingConfig().level === 'debug' ? error.stack : undefined,
        }
      : {}),
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    writeLog(logLevel, 'http_request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: res.getHeader('x-request-id'),
    });
  });

  next();
}

export function logInfo(message: string, metadata?: Record<string, unknown>): void {
  writeLog('info', message, metadata);
}

export function logDebug(message: string, metadata?: Record<string, unknown>): void {
  writeLog('debug', message, metadata);
}

export function logError(message: string, error?: Error, metadata?: Record<string, unknown>): void {
  writeLog('error', message, metadata, error);
}

export function logWarn(message: string, metadata?: Record<string, unknown>): void {
  writeLog('warn', message, metadata);
}

