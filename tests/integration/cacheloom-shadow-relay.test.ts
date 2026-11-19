import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * The live relay publishes to Redis as usual. Only the staging mirror is
 * intercepted; no CacheLoom endpoint or email/SMS provider is contacted.
 */
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('real outbox relay with a staging shadow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CACHELOOM_STAGING_SHADOW;
    delete process.env.CACHELOOM_STAGING_URL;
    delete process.env.CACHELOOM_STAGING_KEY;
  });

  it('mirrors only after Redis and DB commit, and preserves reconciliation', async () => {
    const { prisma } = await import('../../src/db/prisma.js');
    const { notificationQueue } = await import('../../src/queues/notification.queue.js');
    const { drainOutboxOnce, reconcileQueuedJobs } = await import('../../src/services/outbox-relay.js');
    const id = randomUUID();
    const firstOutbox = randomUUID();
    let replacementOutbox = '';
    const captured: Array<{ command: string; idempotencyKey: string; payload: Record<string,string> }> = [];
    process.env.CACHELOOM_STAGING_SHADOW = 'true';
    process.env.CACHELOOM_STAGING_URL = 'http://127.0.0.1:8080';
    process.env.CACHELOOM_STAGING_KEY = 'test-only-staging-secret-longer-than-32-characters';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      captured.push(body);
      // An intentionally fake CacheLoom response; no network/provider activity.
      return { ok: true, json: async () => ({ result: { duplicate: false } }) } as Response;
    });
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: randomUUID(), caller_service: 'staging-shadow-test',
        recipient: 'synthetic@example.test', channel: 'email',
        template_id: 'welcome', payload_data: {}, status: 'pending',
        outbox_events: { create: { id: firstOutbox } },
      } });
      await drainOutboxOnce();
      await vi.waitFor(() => expect(captured.length).toBeGreaterThanOrEqual(1));
      expect(captured[0]).toEqual(expect.objectContaining({
        command: 'ENQUEUE', idempotencyKey: firstOutbox,
        payload: { notificationId: id, outboxId: firstOutbox },
      }));
      expect(JSON.stringify(captured)).not.toContain('synthetic@example.test');
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('queued');
      expect(await notificationQueue.getJob(firstOutbox)).toBeTruthy();

      // The existing reconciliation logic must still work when Redis loses
      // an unpublished/queued job; the shadow is not the authority.
      await (await notificationQueue.getJob(firstOutbox))!.remove();
      await prisma.notification.update({ where: { id },
        data: { updated_at: new Date(Date.now() - 11 * 60_000) } });
      expect(await reconcileQueuedJobs()).toBeGreaterThanOrEqual(1);
      const rows = await prisma.notificationOutbox.findMany({
        where: { notification_id: id }, orderBy: { created_at: 'desc' },
      });
      replacementOutbox = rows.find(row => row.id !== firstOutbox)?.id ?? '';
      expect(replacementOutbox).toBeTruthy();
      await drainOutboxOnce();
      await vi.waitFor(() => expect(captured.some(x => x.idempotencyKey === replacementOutbox)).toBe(true));
      expect(await notificationQueue.getJob(replacementOutbox)).toBeTruthy();
    } finally {
      for (const jobId of [firstOutbox, replacementOutbox]) {
        if (jobId) await (await notificationQueue.getJob(jobId))?.remove().catch(() => undefined);
      }
      await prisma.notification.deleteMany({ where: { id } });
    }
  });
});
