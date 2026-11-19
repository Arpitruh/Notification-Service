import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../../config/env.js';

/**
 * Bootstrap application credentials. Production requires APP_API_KEYS.
 * Each key maps to a caller identity and is never returned in an HTTP response.
 * This will be replaced by DB-backed, rotatable keys in the dashboard phase.
 */
const applications = Object.entries(ENV.APP_API_KEYS).map(([name, key]) => ({
  name,
  digest: crypto.createHash('sha256').update(key).digest(),
}));

export function authenticateApplication(req: Request, res: Response, next: NextFunction): void {
  const presented = req.header('x-api-key');
  if (!presented) {
    res.status(401).json({ error: 'Missing application API key' });
    return;
  }
  const digest = crypto.createHash('sha256').update(presented).digest();
  const application = applications.find(({ digest: expected }) => crypto.timingSafeEqual(expected, digest));
  if (!application) {
    res.status(401).json({ error: 'Invalid application API key' });
    return;
  }
  // Ignore caller-supplied X-Caller-Service to prevent identity spoofing.
  res.locals.applicationName = application.name;
  next();
}
