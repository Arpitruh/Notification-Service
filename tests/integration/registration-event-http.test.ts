import crypto from 'node:crypto';
import express from 'express';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

/**
 * Exercise the actual registration-event HTTP route, database outbox, BullMQ,
 * and worker. SMTP is intercepted before the network: no email is sent.
 * Uses only GitHub Actions' disposable PostgreSQL and Redis services.
 */
const safe = process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUN_DB_TESTS === '1'
  && /^postgresql:\/\/postgres:test-password@localhost:5432\/notification_test(?:\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!safe)('registration event to queued welcome mail (CI only)', () => {
  it('accepts the Auth event once and records one mocked provider acceptance', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationRoutes } = await import('../../src/api/routes/notification.routes.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { drainOutboxOnce } = await import('../../src/services/outbox-relay.ts');
    const { startNotificationWorker } = await import('../../src/workers/notification.worker.ts');
    const { EmailProvider } = await import('../../src/providers/email.provider.ts');

    const slug = 'auth-e2e-' + crypto.randomUUID().slice(0, 10);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const userId = crypto.randomUUID();
    const recipient = 'registered@example.test';
    const app = express();
    app.use(express.json());
    app.use('/api/v1/notifications', notificationRoutes);
    let server: Server | undefined;
    let worker: ReturnType<typeof startNotificationWorker> | undefined;
    let applicationId = '';
    let notificationId = '';
    let outboxId = '';
    const send = vi.spyOn(EmailProvider.prototype, 'sendRendered').mockResolvedValue({
      success: true,
      providerMessageId: '<simulated-acceptance@example.test>',
    });

    try {
      const registered = await prisma.application.create({ data: {
        slug, name: 'CI Registration App', enabled: true,
        dashboard_url: 'https://dashboard.example.test', welcome_enabled: true,
        welcome_template: 'welcome',
        credentials: { create: {
          key_hash: crypto.createHash('sha256').update(apiKey).digest('hex'),
          prefix: 'ci_', label: 'disposable Auth client',
        } },
        templates: { create: {
          slug: 'welcome', subject: 'Welcome to {{appName}}',
          html: '<p>Hello {{name}}. Open {{dashboardUrl}}</p>',
          published: true, archived: false,
          required_variables: ['appName', 'dashboardUrl'],
        } },
      } });
      applicationId = registered.id;
      server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.once('error', reject);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test port');
      const endpoint = 'http://127.0.0.1:' + address.port + '/api/v1/notifications/events/user.registered';
      const post = (email: string) => fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ userId, email }),
      });

      // This matches the wire format emitted by the Auth registration relay.
      const accepted = await post(recipient);
      expect(accepted.status).toBe(202);
      const first = await accepted.json() as { notificationId: string };
      notificationId = first.notificationId;

      // Replays of the same Auth event must not enqueue another email.
      const duplicate = await post(recipient);
      expect(duplicate.status).toBe(200);
      expect((await duplicate.json() as { notificationId: string }).notificationId).toBe(notificationId);
      expect(await prisma.notificationOutbox.count({ where: { notification_id: notificationId } })).toBe(1);

      const outbox = await prisma.notificationOutbox.findFirstOrThrow({
        where: { notification_id: notificationId },
      });
      outboxId = outbox.id;

      // Start the mocked worker and publish the durable event into Redis.
      worker = startNotificationWorker();
      await drainOutboxOnce();
      let state = '';
      for (let i = 0; i < 100; i++) {
        state = (await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).status;
        if (state === 'sent') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(state).toBe('sent');
      expect(send).toHaveBeenCalledTimes(1);
      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
      expect(stored.provider_message_id).toBe('<simulated-acceptance@example.test>');
      const attempts = await prisma.notificationAttempt.findMany({ where: { notification_id: notificationId } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.outcome).toBe('accepted');
      expect(await post(recipient).then(r => r.status)).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      if (worker) await worker.close();
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
      if (outboxId) {
        const job = await notificationQueue.getJob(outboxId);
        if (job) await job.remove().catch(() => undefined);
      }
      if (notificationId) await prisma.notification.deleteMany({ where: { id: notificationId } });
      if (applicationId) await prisma.application.delete({ where: { id: applicationId } });
      send.mockRestore();
    }
  }, 20_000);
});

afterAll(async () => {
  if (safe) {
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    await notificationQueue.close();
  }
});
