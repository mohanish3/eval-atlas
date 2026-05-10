import { Request, Response, NextFunction } from 'express';

export function authentication(req: Request, res: Response, next: NextFunction): void {
  const requiredToken = process.env.API_TOKEN;

  // Only enforce when a token is configured to avoid blocking local development/tests
  if (!requiredToken) {
    return next();
  }

  const providedToken =
    req.header('x-api-token') ||
    req.header('authorization')?.replace(/^Bearer\s+/i, '') ||
    (typeof req.query.token === 'string' ? req.query.token : undefined);

  if (!providedToken || providedToken !== requiredToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
