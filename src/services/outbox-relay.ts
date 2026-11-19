import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { notificationQueue } from '../queues/notification.queue.js';
import { notificationsEnqueued } from '../metrics.js';

const BATCH = 30;
const LEASE_MS = 60_000;
const PERIOD_MS = 2_000;
const ENQUEUE_TIMEOUT_MS = 8_000;

type OutboxRow = { id: string; notification_id: string };

/** Atomic lease permits several relays. A separate lease token fences late writers. */
async function claimBatch(): Promise<OutboxRow[]> {
  return prisma.$queryRaw<OutboxRow[]>`
    UPDATE "notification_outbox" o
    SET claimed_until = now() + interval '60 seconds',
        attempts = attempts + 1
    WHERE o.id IN (
      SELECT id FROM "notification_outbox"
      WHERE published_at IS NULL
        AND next_attempt_at <= now()
        AND (claimed_until IS NULL OR claimed_until < now())
      ORDER BY next_attempt_at, created_at
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o.notification_id
  `;
}

async function publish(row: OutboxRow): Promise<void> {
  const event = await prisma.notificationOutbox.findUnique({
    where: { id: row.id }, include: { notification: true },
  });
  if (!event || event.published_at) return;
  const n = event.notification;
  try {
    if (n.status === 'pending') {
      const payload = {
        notificationId: n.id,
        outboxId: event.id,
        recipient: n.recipient, channel: n.channel, templateId: n.template_id,
        payloadData: n.payload_data as Record<string, unknown>,
        renderedEmail: (n.rendered_email as { subject: string; html: string } | null) ?? undefined,
      };
      const delay = Math.max(0, (n.scheduled_for?.getTime() ?? 0) - Date.now());
      // Timeout bounds application waiting; the Redis operation can still complete
      // after timeout. Retrying with the same retained BullMQ job ID is idempotent.
      await Promise.race([
        notificationQueue.add('dispatch', payload, { jobId: event.id, delay, priority: n.priority }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis enqueue timeout')), ENQUEUE_TIMEOUT_MS)),
      ]);
    }

    await prisma.$transaction([
      prisma.notificationOutbox.updateMany({
        where: { id: event.id, published_at: null },
        data: { published_at: new Date(), claimed_until: null, last_error: null },
      }),
      prisma.notification.updateMany({
        where: { id: n.id, status: 'pending' },
        data: { status: 'queued' },
      }),
    ]);
    if (n.status === 'pending') notificationsEnqueued.inc({ channel: n.channel });
  } catch (e) {
    const backoff = Math.min(300_000, Math.pow(2, Math.min(event.attempts, 8)) * 1000);
    await prisma.notificationOutbox.updateMany({
      where: { id: row.id, published_at: null },
      data: {
        claimed_until: null,
        next_attempt_at: new Date(Date.now() + backoff),
        last_error: 'Enqueue failed; retry scheduled',
      },
    }).catch(err => console.error('[outbox] could not record relay failure', err));
  }
}

export async function drainOutboxOnce(): Promise<number> {
  const rows = await claimBatch();
  for (const row of rows) await publish(row);
  return rows.length;
}

/** Background reconciliation for Redis jobs lost between publish and execution.
 * Only recover queued jobs that are old enough, and only if BullMQ no longer
 * knows their original deterministic job ID. Never auto-resend unknown outcomes.
 */
export async function reconcileQueuedJobs(): Promise<number> {
  const stale = await prisma.notification.findMany({
    where: { status: 'queued', updated_at: { lt: new Date(Date.now() - 10 * 60_000) } },
    select: { id: true },
    take: 30,
  });
  let repaired = 0;
  for (const item of stale) {
    const events = await prisma.notificationOutbox.findMany({
      where: { notification_id: item.id, published_at: { not: null } },
      orderBy: { created_at: 'desc' }, take: 1, select: { id: true },
    });
    if (!events[0]) continue; // legacy jobs: don't invent a new send
    const job = await notificationQueue.getJob(events[0].id);
    if (job) continue; // delayed/waiting/active job still exists
    const moved = await prisma.$transaction(async tx => {
      const changed = await tx.notification.updateMany({
        where: { id: item.id, status: 'queued' }, data: { status: 'pending' },
      });
      if (!changed.count) return false;
      await tx.notificationOutbox.create({ data: { notification_id: item.id } });
      return true;
    });
    if (moved) repaired++;
  }
  return repaired;
}

export function startOutboxRelay(): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();
  let tickCount = 0;
  const tick = (): void => {
    if (stopped) return;
    active = (async () => {
      try {
        let count: number;
        do { count = await drainOutboxOnce(); } while (!stopped && count === BATCH);
        if (++tickCount % 30 === 0) await reconcileQueuedJobs();
      } catch (e) { console.error('[outbox] relay poll failed', e); }
    })().finally(() => { if (!stopped) timer = setTimeout(tick, PERIOD_MS); });
  };
  tick();
  return { stop: async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  } };
}
