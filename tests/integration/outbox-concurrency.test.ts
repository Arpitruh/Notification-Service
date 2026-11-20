import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';

/**
 * Run against an isolated migrated staging database:
 *   RUN_DB_TESTS=1 DATABASE_URL=... npm test
 * Never point this suite at production; it writes real notification records.
 */
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('notification transactional outbox (staging DB)', () => {
  it('creates one logical record/outbox row under 20 concurrent requests', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.ts');
    const key = 'concurrency-test-' + crypto.randomUUID();
    const app = 'test-' + crypto.randomUUID().slice(0, 8);
    const results: Array<{ status: number; body: Record<string, unknown> }> = [];

    try {
      await Promise.all(Array.from({ length: 20 }, async () => {
        let status = 200;
        const res = {
          locals: { applicationName: app },
          status(next: number) { status = next; return this; },
          json(body: Record<string, unknown>) { results.push({ status, body }); return this; },
        } as unknown as Response;
        const req = { headers: {}, body: {
          recipient: 'concurrent@example.test',
          channel: 'email',
          templateId: 'welcome',
          payloadData: { name: 'Concurrent' },
          idempotencyKey: key,
        } } as Request;
        await sendNotification(req, res);
      }));
      const created = results.filter(r => r.status === 202);
      const duplicates = results.filter(r => r.status === 200);
      expect(created).toHaveLength(1);
      expect(duplicates).toHaveLength(19);
      const notificationId = String(created[0]!.body.notificationId);
      expect(results.every(r => r.body.notificationId === notificationId)).toBe(true);
      expect(await prisma.notificationOutbox.count({ where: { notification_id: notificationId } })).toBe(1);
      expect(await prisma.notification.count({ where: { id: notificationId } })).toBe(1);
    } finally {
      const ids = results.map(r => String(r.body.notificationId)).filter(Boolean);
      if (ids.length) await prisma.notification.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('returns 409 when one idempotency key is reused with a changed recipient', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.ts');
    const key = 'conflict-test-' + crypto.randomUUID();
    const app = 'test-' + crypto.randomUUID().slice(0, 8);
    let id = '';
    async function send(recipient: string) {
      let status = 200;
      let data: Record<string, unknown> = {};
      const res = {
        locals: { applicationName: app },
        status(next: number) { status = next; return this; },
        json(body: Record<string, unknown>) { data = body; return this; },
      } as unknown as Response;
      await sendNotification({ headers: {}, body: { recipient, channel: 'email', templateId: 'welcome',
        payloadData: {}, idempotencyKey: key } } as Request, res);
      return { status, data };
    }
    try {
      const accepted = await send('one@example.test');
      id = String(accepted.data.notificationId);
      expect(accepted.status).toBe(202);
      const conflict = await send('two@example.test');
      expect(conflict.status).toBe(409);
      expect(conflict.data.error).toBe('IDEMPOTENCY_KEY_REUSED');
    } finally {
      if (id) await prisma.notification.deleteMany({ where: { id } });
    }
  });

  it('deduplicates registration events per application and user ID', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.ts');
    const userId = crypto.randomUUID();
    const firstApp = 'registration-' + crypto.randomUUID().slice(0, 8);
    const secondApp = 'registration-' + crypto.randomUUID().slice(0, 8);
    const notificationIds: string[] = [];

    async function submit(app: string, recipient: string) {
      let status = 200;
      let body: Record<string, unknown> = {};
      const res = {
        locals: { applicationName: app, idempotencyMode: 'event' },
        status(value: number) { status = value; return this; },
        json(value: Record<string, unknown>) { body = value; return this; },
      } as unknown as Response;
      await sendNotification({ headers: {}, body: {
        recipient, channel: 'email', templateId: 'welcome',
        payloadData: { name: 'Someone', appName: app, dashboardUrl: 'https://example.test' },
        idempotencyKey: 'registration-welcome:' + userId,
      } } as Request, res);
      if (body.notificationId) notificationIds.push(String(body.notificationId));
      return { status, id: String(body.notificationId) };
    }

    try {
      const created = await submit(firstApp, 'first@example.test');
      const duplicate = await submit(firstApp, 'first@example.test');
      // If a user's address changed during retry, the immutable registration
      // identity still must not produce a second welcome notification.
      const changedEmailRetry = await submit(firstApp, 'changed@example.test');
      const isolated = await submit(secondApp, 'first@example.test');

      expect(created.status).toBe(202);
      expect(duplicate.status).toBe(200);
      expect(changedEmailRetry.status).toBe(200);
      expect(duplicate.id).toBe(created.id);
      expect(changedEmailRetry.id).toBe(created.id);
      expect(isolated.status).toBe(202);
      expect(isolated.id).not.toBe(created.id);

      expect(await prisma.notificationOutbox.count({
        where: { notification_id: { in: [created.id, isolated.id] } },
      })).toBe(2);
    } finally {
      if (notificationIds.length) {
        await prisma.notification.deleteMany({
          where: { id: { in: notificationIds } },
        });
      }
    }
  });

  it('rebuilds a published-but-lost Redis job from the PostgreSQL outbox', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { drainOutboxOnce, reconcileQueuedJobs } = await import('../../src/services/outbox-relay.ts');
    const id = crypto.randomUUID();
    const firstOutbox = crypto.randomUUID();
    let nextOutbox = '';
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: crypto.randomUUID(), caller_service: 'ci-test',
        recipient: 'rebuild@example.test', channel: 'email',
        template_id: 'welcome', payload_data: {}, status: 'pending',
        outbox_events: { create: { id: firstOutbox } },
      } });
      await drainOutboxOnce();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('queued');
      const lostJob = await notificationQueue.getJob(firstOutbox);
      expect(lostJob).toBeTruthy();
      await lostJob!.remove(); // Simulate Redis losing the queued job.
      await prisma.notification.update({ where: { id },
        data: { updated_at: new Date(Date.now() - 11 * 60_000) } });
      expect(await reconcileQueuedJobs()).toBeGreaterThanOrEqual(1);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
      const outboxes = await prisma.notificationOutbox.findMany({
        where: { notification_id: id }, orderBy: { created_at: 'desc' },
      });
      expect(outboxes).toHaveLength(2);
      nextOutbox = outboxes.find(row => row.id !== firstOutbox)!.id;
      await drainOutboxOnce();
      expect(await notificationQueue.getJob(nextOutbox)).toBeTruthy();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('queued');
    } finally {
      for (const jobId of [firstOutbox, nextOutbox]) {
        if (!jobId) continue;
        const job = await notificationQueue.getJob(jobId);
        if (job) await job.remove().catch(() => undefined);
      }
      await prisma.notification.deleteMany({ where: { id } });
    }
  });

  it('keeps the committed outbox event when Redis enqueue fails, then publishes on retry', async () => {
    const { vi } = await import('vitest');
    const { prisma } = await import('../../src/db/prisma.ts');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { drainOutboxOnce } = await import('../../src/services/outbox-relay.ts');
    let status = 200;
    let result: Record<string, unknown> = {};
    const res = { locals: { applicationName: 'outbox-recovery-test' },
      status(n: number) { status = n; return this; },
      json(body: Record<string, unknown>) { result = body; return this; },
    } as unknown as Response;
    const req = { headers: {}, body: {
      recipient: 'recovery@example.test',
      channel: 'email', templateId: 'welcome',
      payloadData: {}, idempotencyKey: crypto.randomUUID(),
    } } as Request;
    let outboxId = '';
    let notificationId = '';
    const originalAdd = notificationQueue.add.bind(notificationQueue);
    try {
      await sendNotification(req, res);
      expect(status).toBe(202);
      notificationId = String(result.notificationId);
      const outbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { notification_id: notificationId } });
      outboxId = outbox.id;
      const spy = vi.spyOn(notificationQueue, 'add').mockRejectedValueOnce(new Error('Redis offline'));
      await drainOutboxOnce();
      spy.mockRestore();
      expect((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } })).published_at).toBeNull();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).status).toBe('pending');

      await prisma.notificationOutbox.update({ where: { id: outboxId },
        data: { next_attempt_at: new Date(Date.now() - 1000), claimed_until: null } });
      await drainOutboxOnce();
      expect((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } })).published_at).not.toBeNull();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).status).toBe('queued');
    } finally {
      vi.restoreAllMocks();
      if (outboxId) {
        const job = await notificationQueue.getJob(outboxId);
        if (job) await job.remove().catch(() => undefined);
      }
      if (notificationId) await prisma.notification.deleteMany({ where: { id: notificationId } });
      await notificationQueue.close();
    }
  });

});
