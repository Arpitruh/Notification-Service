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
    const { prisma } = await import('../../src/db/prisma.js');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.js');
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
    const { prisma } = await import('../../src/db/prisma.js');
    const { sendNotification } = await import('../../src/api/controllers/notification.controller.js');
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
});
