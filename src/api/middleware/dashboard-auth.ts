import type { Request, Response, NextFunction } from 'express';

export type DashboardIdentity = { sub: string; email: string };

export async function requireDashboardIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = /^Bearer (.+)$/.exec(req.header('authorization') || '')?.[1];
  const url = process.env.AUTH_SERVICE_URL;
  const key = process.env.AUTH_SERVICE_KEY;
  if (!token) { res.status(401).json({ error: 'Login required' }); return; }
  if (!url || !key) { res.status(503).json({ error: 'Dashboard login not configured' }); return; }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/auth/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-service-key': key },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) { res.status(503).json({ error: 'Authentication unavailable' }); return; }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('active' in data) || data.active !== true ||
        !('sub' in data) || typeof data.sub !== 'string' ||
        !('email' in data) || typeof data.email !== 'string') {
      res.status(401).json({ error: 'Invalid session' }); return;
    }
    res.locals.identity = { sub: data.sub, email: data.email } satisfies DashboardIdentity;
    next();
  } catch {
    res.status(503).json({ error: 'Authentication unavailable' });
  }
}

export function isPlatformAdmin(subject: string): boolean {
  return (process.env.DASHBOARD_ADMIN_SUBJECTS || '').split(',').map(s => s.trim()).filter(Boolean).includes(subject);
}
