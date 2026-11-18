import { Redis } from 'ioredis';
import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../../config/env.js';
import type { NotificationClient } from '../../lib/client-auth.js';

// Separate, dedicated Redis client for atomic quotas across every API replica.
const redis = new Redis({
  host: ENV.REDIS_HOST,
  port: ENV.REDIS_PORT,
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
redis.on('error', () => { /* Requests fail closed on Redis errors. */ });
let connecting: Promise<void> | undefined;
async function ready(): Promise<Redis> {
  if (redis.status !== 'ready') {
    if (!connecting) connecting = redis.connect().finally(() => { connecting = undefined; });
    await connecting;
  }
  return redis;
}

// One atomic script checks BOTH quotas before increasing either counter.
const quotaScript = `
local currentMinute = tonumber(redis.call('GET', KEYS[1]) or '0')
local currentDay = tonumber(redis.call('GET', KEYS[2]) or '0')
if currentMinute >= tonumber(ARGV[1]) or currentDay >= tonumber(ARGV[2]) then
  return 0
end
local minute = redis.call('INCR', KEYS[1])
if minute == 1 then redis.call('EXPIRE', KEYS[1], 60) end
local day = redis.call('INCR', KEYS[2])
if day == 1 then redis.call('EXPIRE', KEYS[2], 86400) end
return 1
`;

export async function takeClientQuota(clientId: string): Promise<boolean> {
  const client = await ready();
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / 60);
  const day = Math.floor(now / 86400);
  const allowed = await client.eval(
    quotaScript, 2,
    'notifications:quota:minute:' + clientId + ':' + minute,
    'notifications:quota:day:' + clientId + ':' + day,
    String(ENV.CLIENT_RATE_LIMIT_PER_MINUTE), String(ENV.CLIENT_DAILY_QUOTA),
  );
  return Number(allowed) === 1;
}

export async function clientQuotaLimiter(_req: Request, res: Response, next: NextFunction): Promise<void> {
  const caller = res.locals.notificationClient as NotificationClient | undefined;
  if (!caller) { res.status(401).json({ error: 'Unauthenticated.' }); return; }
  try {
    if (!await takeClientQuota(caller.id)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Client notification quota exceeded.' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'Notification rate limiter unavailable.' });
  }
}
export function closeClientQuotaLimiter(): void { redis.disconnect(); }
