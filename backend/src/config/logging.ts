import dotenv from 'dotenv';

dotenv.config();

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const DEFAULT_REDACT_KEYS = ['password', 'token', 'secret', 'api_key', 'authorization'];

export interface LoggingConfig {
  level: LogLevel;
  redactKeys: string[];
}

let cachedConfig: LoggingConfig | null = null;

export function getLoggingConfig(): LoggingConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const level = (process.env.LOG_LEVEL as LogLevel) || 'info';
  const redactKeys = process.env.LOG_REDACT_KEYS
    ? process.env.LOG_REDACT_KEYS.split(',').map((key) => key.trim())
    : DEFAULT_REDACT_KEYS;

  cachedConfig = { level, redactKeys };
  return cachedConfig;
}

export function shouldLog(level: LogLevel): boolean {
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  const config = getLoggingConfig();
  return order[level] >= order[config.level];
}

export function redactMetadata(
  metadata?: Record<string, unknown>,
  redactKeys: string[] = getLoggingConfig().redactKeys
): Record<string, unknown> | undefined {
  if (!metadata) {
    return metadata;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (redactKeys.some((k) => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
