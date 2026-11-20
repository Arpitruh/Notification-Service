import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

// This suite is intentionally destructive to Redis. Only the dedicated GitHub
// Actions job may opt in, and only against its disposable localhost services.
const safe = process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUN_REDIS_LOSS_TESTS === '1'
  && process.env.RUN_DB_TESTS === '1'
  && /^postgresql:\/\/postgres:test-password@localhost:5432\/notification_test(?:\?|$)/.test(process.env.DATABASE_URL ?? '')
  && !process.env.REDIS_URL
  && (!process.env.REDIS_HOST || ['localhost', '127.0.0.1'].includes(process.env.REDIS_HOST))
  && (!process.env.REDIS_PORT || process.env.REDIS_PORT === '6379');

describe.skipIf(!safe)('rebuild queued work after CI-only Redis data loss', () => {
  it('recovers a lost queue and does not invoke a delivery provider', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { drainOutboxOnce, reconcileQueuedJobs } = await import('../../src/services/outbox-relay.ts');
    const { EmailProvider } = await import('../../src/providers/email.provider.ts');
    const { vi } = await import('vitest');
    const notificationId = crypto.randomUUID();
    const initialOutboxId = crypto.randomUUID();
    let replacementOutboxId = '';
    const send = vi.spyOn(EmailProvider.prototype, 'sendRendered')
      .mockRejectedValue(new Error('No SMTP should be called in this recovery test'));
    try {
      await prisma.notification.create({ data: {
        id: notificationId, idempotency_key: crypto.randomUUID(),
        recipient: 'redis-loss@example.test', channel: 'email', template_id: 'welcome',
        payload_data: {}, caller_service: 'ci-redis-loss', status: 'pending',
        outbox_events: { create: { id: initialOutboxId } },
      } });
      await drainOutboxOnce();
      expect(await notificationQueue.getJob(initialOutboxId)).toBeTruthy();

      // Simulate losing *all* queued Redis state, not just deleting one job.
      // This can only run with the disposable CI database and localhost Redis.
      const { default: Redis } = await import('ioredis');
      const disposableRedis = new Redis({ host: '127.0.0.1', port: 6379 });
      try {
        await disposableRedis.flushdb();
      } finally {
        await disposableRedis.quit();
      }
      expect(await notificationQueue.getJob(initialOutboxId)).toBeFalsy();

      // Reconciliation intentionally ignores recent jobs, allowing a grace
      // period for normal Redis/BullMQ delays before declaring a job lost.
      await prisma.notification.update({ where: { id: notificationId },
        data: { updated_at: new Date(Date.now() - 11 * 60_000) } });
      expect(await reconcileQueuedJobs()).toBeGreaterThanOrEqual(1);
      expect((await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })).status).toBe('pending');

      const events = await prisma.notificationOutbox.findMany({
        where: { notification_id: notificationId },
      });
      expect(events).toHaveLength(2);
      replacementOutboxId = events.find(e => e.id !== initialOutboxId)!.id;
      await drainOutboxOnce();

      expect(await notificationQueue.getJob(replacementOutboxId)).toBeTruthy();
      expect((await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })).status).toBe('queued');
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      for (const id of [initialOutboxId, replacementOutboxId]) {
        if (!id) continue;
        const job = await notificationQueue.getJob(id);
        if (job) await job.remove().catch(() => undefined);
      }
      await prisma.notification.deleteMany({ where: { id: notificationId } });
    }
  }, 20_000);
});

afterAll(async () => {
  if (safe) {
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    await notificationQueue.close();
  }
});
