import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const firstKey = 'ci-test-notification-auth-service-long-key';
const secondKey = 'ci-test-notification-second-service-long-key';

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('authenticated notification HTTP workflows', () => {
  let server: Server;
  let base: string;
  let prisma: (typeof import('../../src/db/prisma.js'))['prisma'];
  let queue: (typeof import('../../src/queues/notification.queue.js'))['notificationQueue'];

  beforeAll(async () => {
    const [{ createApp }, db, q] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/db/prisma.js'),
      import('../../src/queues/notification.queue.js'),
    ]);
    prisma = db.prisma;
    queue = q.notificationQueue;
    await prisma.$queryRaw`SELECT 1`;
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('No local test port');
    base = 'http://127.0.0.1:' + addr.port;
  }, 25000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (queue) await queue.close();
    if (prisma) await prisma.$disconnect();
  });

  async function send(body: unknown, key?: string) {
    return fetch(base + '/api/v1/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'x-notification-api-key': key } : {}) },
      body: JSON.stringify(body),
    });
  }

  const welcome = () => ({
    recipient: 'recipient@example.com',
    channel: 'email',
    templateId: 'welcome',
    payloadData: { name: 'Reader', dashboardUrl: 'https://example.com' },
    idempotencyKey: 'ci-' + randomUUID(),
  });

  it('denies anonymous sends and unauthorized template use', async () => {
    const body = welcome();
    expect((await send(body)).status).toBe(401);
    expect((await send({ ...body, templateId: 'forgot-password' }, secondKey)).status).toBe(403);
  });

  it('enqueues, deduplicates and isolates notifications by caller', async () => {
    const body = welcome();
    const created = await send(body, firstKey);
    expect(created.status).toBe(202);
    const result = await created.json() as { notificationId: string };
    expect(result.notificationId).toBeTruthy();
    expect((await send(body, firstKey)).status).toBe(200);
    expect((await send({ ...body, recipient: 'other@example.com' }, firstKey)).status).toBe(409);

    const own = await fetch(base + '/api/v1/notifications/' + result.notificationId, {
      headers: { 'x-notification-api-key': firstKey },
    });
    expect(own.status).toBe(200);
    const other = await fetch(base + '/api/v1/notifications/' + result.notificationId, {
      headers: { 'x-notification-api-key': secondKey },
    });
    expect(other.status).toBe(404);

    // The same caller-supplied key cannot collide across separate client IDs.
    expect((await send(body, secondKey)).status).toBe(202);
  });

  it('checks database and Redis readiness and protects metrics', async () => {
    expect((await fetch(base + '/health')).status).toBe(200);
    expect((await fetch(base + '/ready')).status).toBe(200);
    expect((await fetch(base + '/metrics')).status).toBe(401);
    expect((await fetch(base + '/metrics', {
      headers: { 'x-metrics-api-key': 'ci-test-notification-metrics-key-long-value' },
    })).status).toBe(200);
  });
});
