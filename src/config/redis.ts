import type { ConnectionOptions } from 'bullmq';
import { isIP } from 'node:net';
import { ENV } from './env.js';

/**
 * A single configuration for BullMQ Queue and Worker.
 * Use rediss:// for external production Redis. Private/local Redis may use
 * plaintext on the trusted network (including the legacy Render host/port).
 */
export function buildRedisConnection(
  url = process.env.REDIS_URL,
  nodeEnv = process.env.NODE_ENV,
): ConnectionOptions {
  if (!url) {
    return { host: ENV.REDIS_HOST, port: ENV.REDIS_PORT, connectTimeout: 10_000 };
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid REDIS_URL'); }
  if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'rediss:' ? 6380 : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REDIS_URL port');
  const dbText = parsed.pathname.replace(/^\//, '');
  if (dbText && (!/^\d+$/.test(dbText) || Number(dbText) > 15)) throw new Error('Invalid REDIS_URL database');
  const host = parsed.hostname.toLowerCase();
  // Do not permit insecure remote Redis in production. Legacy private Redis
  // continues to work via REDIS_HOST/REDIS_PORT without configuring a URL.
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const privateIp = isIP(host) === 4 && (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
  const privateHostname = host.endsWith('.internal') || host.endsWith('.render.internal');
  if (nodeEnv === 'production' && parsed.protocol === 'redis:' && !(local || privateIp || privateHostname)) {
    throw new Error('Production REDIS_URL requires rediss:// for external Redis');
  }
  return {
    host: parsed.hostname,
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbText ? Number(dbText) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: 10_000,
  };
}

export const redisConnection: ConnectionOptions = buildRedisConnection();
