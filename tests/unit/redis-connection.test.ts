import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/config/env.js', () => ({ ENV: { REDIS_HOST: 'localhost', REDIS_PORT: 6379 } }));
const { buildRedisConnection } = await import('../../src/config/redis.js');
describe('Redis transport configuration', () => {
  it('supports legacy private host and port', () => {
    expect(buildRedisConnection(undefined, 'production')).toMatchObject({ host: 'localhost', port: 6379 });
  });
  it('parses rediss URL with TLS, auth and DB', () => {
    expect(buildRedisConnection('rediss://user:secret@redis.example.com:6380/1','production')).toMatchObject({
      host: 'redis.example.com', port: 6380, username: 'user', password: 'secret', db: 1, tls: {},
    });
  });
  it('rejects unsupported schemes and insecure external production Redis', () => {
    expect(() => buildRedisConnection('https://redis.example.com','production')).toThrow();
    expect(() => buildRedisConnection('redis://redis.example.com:6379','production')).toThrow();
    expect(() => buildRedisConnection('redis://10.0.0.5:6379','production')).not.toThrow();
  });
  it('rejects invalid DB index', () => {
    expect(() => buildRedisConnection('rediss://redis.example.com/not-a-db','production')).toThrow();
  });
});
