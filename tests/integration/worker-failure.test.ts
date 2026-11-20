import crypto from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Runs only in ephemeral PostgreSQL + Redis GitHub CI. Never use production.
 * Delivery is intercepted at the provider boundary; no external email sent.
 */
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('worker failure injection (staging DB + Redis)', () => {
  it('delivers a logical notification at most once with two independent BullMQ job IDs', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { EmailProvider } = await import('../../src/providers/email.provider.ts');
    const { startNotificationWorker } = await import('../../src/workers/notification.worker.ts');
    const id = crypto.randomUUID();
    const key = crypto.randomUUID();
    const firstJob = 'duplicate-a-' + id;
    const secondJob = 'duplicate-b-' + id;
    const send = vi.spyOn(EmailProvider.prototype, 'sendRendered').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
      return { success: true, providerMessageId: '<fake-message@example.test>' };
    });
    let worker: ReturnType<typeof startNotificationWorker> | undefined;
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: key, recipient: 'test@example.test', channel: 'email',
        template_id: 'welcome', payload_data: {}, status: 'queued',
        rendered_email: { subject: 'Test', html: '<p>Hello</p>' }, caller_service: 'ci-test',
      } });
      worker = startNotificationWorker();
      await Promise.all([
        notificationQueue.add('dispatch', { notificationId: id }, { jobId: firstJob }),
        notificationQueue.add('dispatch', { notificationId: id }, { jobId: secondJob }),
      ]);
      let status: string | undefined;
      for (let i = 0; i < 70; i++) {
        status = (await prisma.notification.findUnique({ where: { id } }))?.status;
        if (status === 'sent') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(status).toBe('sent');
      // Let the other job finish its terminal-state check as well.
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.notificationAttempt.count({ where: { notification_id: id } })).toBe(1);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).provider_message_id)
        .toBe('<fake-message@example.test>');
    } finally {
      if (worker) await worker.close();
      await Promise.all([firstJob, secondJob].map(async jobId =>
        (await notificationQueue.getJob(jobId))?.remove().catch(() => undefined)));
      await prisma.notification.deleteMany({ where: { id } });
      send.mockRestore();
    }
  });

  it('reaps an abandoned processing attempt as unknown, without replaying it', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { reapExpiredDeliveryClaims } = await import('../../src/workers/notification.worker.ts');
    const id = crypto.randomUUID();
    const fence = crypto.randomUUID();
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: crypto.randomUUID(), recipient: 'unknown@example.test',
        channel: 'email', template_id: 'welcome', payload_data: {},
        status: 'processing', caller_service: 'ci-test', locked_by: fence,
        locked_until: new Date(Date.now() - 1000),
      } });
      await prisma.notificationAttempt.create({ data: {
        notification_id: id, attempt_number: 1, provider: 'smtp', outcome: 'started',
      } });
      await reapExpiredDeliveryClaims();
      const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
      const attempt = await prisma.notificationAttempt.findFirstOrThrow({ where: { notification_id: id } });
      expect(n.status).toBe('unknown');
      expect(n.locked_by).toBeNull();
      expect(attempt.outcome).toBe('unknown');
      expect(attempt.error_code).toBe('DELIVERY_LEASE_EXPIRED');
    } finally {
      await prisma.notification.deleteMany({ where: { id } });
    }
  });

  it('marks stale pre-migration processing rows without worker lease as unknown', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { reapExpiredDeliveryClaims } = await import('../../src/workers/notification.worker.ts');
    const id = crypto.randomUUID();
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: crypto.randomUUID(), recipient: 'legacy@example.test',
        channel: 'email', template_id: 'welcome', payload_data: {},
        status: 'processing', caller_service: 'ci-test', locked_by: null,
        locked_until: null, updated_at: new Date(Date.now() - 12 * 60_000),
      } });
      await reapExpiredDeliveryClaims();
      const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
      expect(n.status).toBe('unknown');
      expect(n.locked_by).toBeNull();
    } finally {
      await prisma.notification.deleteMany({ where: { id } });
    }
  });


  it('holds an ambiguous SMTP DATA timeout for review instead of blindly resending', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { EmailProvider } = await import('../../src/providers/email.provider.ts');
    const { startNotificationWorker } = await import('../../src/workers/notification.worker.ts');
    const id = crypto.randomUUID();
    const jobId = 'smtp-ambiguous-' + id;
    const duplicateId = 'smtp-retry-' + id;
    const send = vi.spyOn(EmailProvider.prototype, 'sendRendered').mockResolvedValue({
      success: false,
      error: 'Synthetic timeout after SMTP DATA',
      errorCode: 'ETIMEDOUT',
      ambiguous: true,
      retryable: true,
    });
    let worker: ReturnType<typeof startNotificationWorker> | undefined;
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: crypto.randomUUID(),
        recipient: 'ambiguous@example.test', channel: 'email',
        template_id: 'welcome', payload_data: {}, status: 'queued',
        caller_service: 'ci-test',
        rendered_email: { subject: 'Test', html: '<p>Test</p>' },
      } });
      worker = startNotificationWorker();
      await notificationQueue.add('dispatch', { notificationId: id }, { jobId, attempts: 3 });
      let state: string | undefined;
      for (let i = 0; i < 80; i++) {
        state = (await prisma.notification.findUnique({ where: { id } }))?.status;
        if (state === 'unknown') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(state).toBe('unknown');
      const attempt = await prisma.notificationAttempt.findFirstOrThrow({
        where: { notification_id: id },
      });
      expect(attempt.outcome).toBe('unknown');
      expect(attempt.retryable).toBe(false);
      expect(attempt.error_code).toBe('ETIMEDOUT');
      expect(send).toHaveBeenCalledTimes(1);

      // Even a second BullMQ job must not turn an uncertain result into a
      // second external send. Only an audited operator replay may do that.
      await notificationQueue.add('dispatch', { notificationId: id }, { jobId: duplicateId });
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      if (worker) await worker.close();
      for (const key of [jobId, duplicateId]) {
        const job = await notificationQueue.getJob(key);
        if (job) await job.remove().catch(() => undefined);
      }
      await prisma.notification.deleteMany({ where: { id } });
      send.mockRestore();
    }
  }, 15_000);

  it('does not resend if SMTP accepted but the database cannot persist success', async () => {
    const { prisma } = await import('../../src/db/prisma.ts');
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    const { EmailProvider } = await import('../../src/providers/email.provider.ts');
    const { startNotificationWorker, reapExpiredDeliveryClaims } = await import('../../src/workers/notification.worker.ts');
    const id = crypto.randomUUID();
    const jobId = 'db-after-smtp-' + id;
    const txSpy = vi.spyOn(prisma, '$transaction');
    const send = vi.spyOn(EmailProvider.prototype, 'sendRendered').mockImplementation(async () => {
      // Inject failure precisely AFTER SMTP reported acceptance.
      txSpy.mockRejectedValueOnce(new Error('synthetic Postgres outage after SMTP acceptance'));
      return { success: true, providerMessageId: '<accepted-but-uncommitted@example.test>' };
    });
    let worker: ReturnType<typeof startNotificationWorker> | undefined;
    try {
      await prisma.notification.create({ data: {
        id, idempotency_key: crypto.randomUUID(), recipient: 'test@example.test',
        channel: 'email', template_id: 'welcome',
        payload_data: {}, status: 'queued', caller_service: 'ci-test',
        rendered_email: { subject: 'Test', html: '<p>Hello</p>' },
      } });
      worker = startNotificationWorker();
      await notificationQueue.add('dispatch', { notificationId: id }, { jobId });
      let failed = false;
      for (let i = 0; i < 80; i++) {
        const job = await notificationQueue.getJob(jobId);
        if (job && await job.getState() === 'failed') { failed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(failed).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('processing');
      txSpy.mockRestore();
      await prisma.notification.update({ where: { id },
        data: { locked_until: new Date(Date.now() - 1000) } });
      await reapExpiredDeliveryClaims();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('unknown');
      expect((await prisma.notificationAttempt.findFirstOrThrow({
        where: { notification_id: id },
      })).outcome).toBe('unknown');
      // Existing failed BullMQ job does not cause automatic SMTP resend.
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      txSpy.mockRestore();
      if (worker) await worker.close();
      const job = await notificationQueue.getJob(jobId);
      if (job) await job.remove().catch(() => undefined);
      await prisma.notification.deleteMany({ where: { id } });
      send.mockRestore();
    }
  }, 15_000);

});

afterAll(async () => {
  if (process.env.RUN_DB_TESTS === '1') {
    const { notificationQueue } = await import('../../src/queues/notification.queue.ts');
    await notificationQueue.close();
  }
});
