import { describe, expect, it, vi } from 'vitest';
import {
  mapShadowEvent, mirrorOutboxToCacheloom, readShadowConfig,
} from '../src/services/cacheloom-staging-shadow.js';

const key = 'staging-only-test-secret-which-is-long-enough';
const event = {
  outboxId: 'outbox-001',
  notificationId: 'notification-001',
  scheduledFor: new Date('2026-11-19T12:01:00Z'),
  priority: 10,
};

describe('CacheLoom staging-only shadow', () => {
  it('stays disabled by default and refuses to run in production', () => {
    expect(readShadowConfig({} as NodeJS.ProcessEnv)).toEqual({ enabled: false });
    expect(() => readShadowConfig({
      CACHELOOM_STAGING_SHADOW: 'true',
      CACHELOOM_STAGING_URL: 'https://staging.example.test',
      CACHELOOM_STAGING_KEY: key,
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv)).toThrow(/forbidden in production/);
  });

  it('rejects remote HTTP and credentials embedded in URLs', () => {
    expect(() => readShadowConfig({
      CACHELOOM_STAGING_SHADOW: 'true',
      CACHELOOM_STAGING_URL: 'http://remote.example.test',
      CACHELOOM_STAGING_KEY: key,
    } as NodeJS.ProcessEnv)).toThrow(/requires HTTPS/);
    expect(() => readShadowConfig({
      CACHELOOM_STAGING_SHADOW: 'true',
      CACHELOOM_STAGING_URL: 'https://user:pass@staging.example.test',
      CACHELOOM_STAGING_KEY: key,
    } as NodeJS.ProcessEnv)).toThrow(/must not contain credentials/);
    expect(readShadowConfig({
      CACHELOOM_STAGING_SHADOW: 'true',
      CACHELOOM_STAGING_URL: 'http://127.0.0.1:8080',
      CACHELOOM_STAGING_KEY: key,
    } as NodeJS.ProcessEnv).enabled).toBe(true);
  });

  it('maps only outbox IDs, scheduling, and priority, never personal data', () => {
    const result = mapShadowEvent({
      ...event,
      recipient: 'someone@example.com', renderedEmail: { html: 'private' },
    } as typeof event, Date.parse('2026-11-19T12:00:00Z'));
    expect(result).toEqual({
      command: 'ENQUEUE', queue: 'notifications-standard-staging',
      payload: { notificationId: event.notificationId, outboxId: event.outboxId },
      idempotencyKey: event.outboxId, maxAttempts: 3, priority: 10, delaySeconds: 60,
    });
    expect(JSON.stringify(result)).not.toContain('someone@example.com');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('sends an authenticated idempotent enqueue request to staging only', async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string,string>).authorization).toBe('Bearer ' + key);
      expect(JSON.parse(String(init.body)).idempotencyKey).toBe(event.outboxId);
      return { ok: true, json: async () => ({ result: { duplicate: true } }) };
    });
    const result = await mirrorOutboxToCacheloom(event, {
      enabled: true, url: 'http://127.0.0.1:8080', apiKey: key,
    }, fetcher as unknown as typeof fetch);
    expect(result).toEqual({ mirrored: true, duplicate: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never contacts staging when feature flag is off', async () => {
    const fetcher = vi.fn();
    expect(await mirrorOutboxToCacheloom(event, { enabled: false }, fetcher)).toEqual({ mirrored: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails safely when staging is unavailable', async () => {
    await expect(mirrorOutboxToCacheloom(event, {
      enabled: true, url: 'http://127.0.0.1:8080', apiKey: key,
    }, vi.fn(async () => { throw new Error('offline'); }) as typeof fetch)).rejects.toThrow('offline');
  });
});
