import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';

const bootstrap = Object.entries(ENV.APP_API_KEYS).map(([name, key]) => ({
  name, digest: crypto.createHash('sha256').update(key).digest(),
}));

/**
 * Database-managed keys are SHA-256 digests (plaintext is shown only on creation).
 * Legacy environment keys remain valid during rollout; they can be rotated away
 * once all callers switch to credentials created from the dashboard.
 */
export async function authenticateApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header('x-api-key');
  if (!key) { res.status(401).json({ error: 'Missing application API key' }); return; }
  try {
    const digest = crypto.createHash('sha256').update(key).digest();
    const credential = await prisma.applicationCredential.findUnique({
      where: { key_hash: digest.toString('hex') },
      include: { application: true },
    });
    if (credential && !credential.revoked_at && credential.application.enabled) {
      res.locals.applicationName = credential.application.slug;
      next();
      return;
    }
    const legacy = bootstrap.find(({ digest: expected }) => crypto.timingSafeEqual(digest, expected));
    if (legacy) {
      const registered = await prisma.application.findUnique({ where: { slug: legacy.name } });
      if (registered?.enabled === false) {
        res.status(403).json({ error: 'Application disabled' }); return;
      }
      res.locals.applicationName = legacy.name;
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid or revoked application API key' });
  } catch (err) { next(err); }
}
