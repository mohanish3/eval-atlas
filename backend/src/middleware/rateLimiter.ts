import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

const defaultOptions: RateLimitOptions = {
  windowMs: 60_000,
  max: 60,
};

type ClientKey = string;

interface Bucket {
  count: number;
  expiresAt: number;
}

const buckets: Map<ClientKey, Bucket> = new Map();

export function rateLimiter(options: Partial<RateLimitOptions> = {}) {
  const config = { ...defaultOptions, ...options };

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (existing && existing.expiresAt > now) {
      if (existing.count >= config.max) {
        res.status(429).json({
          error: 'Too many requests. Please slow down.',
          retryAfterMs: existing.expiresAt - now,
        });
        return;
      }

      existing.count += 1;
      buckets.set(key, existing);
    } else {
      buckets.set(key, { count: 1, expiresAt: now + config.windowMs });
    }

    next();
  };
}
