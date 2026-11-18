import { notificationQueue } from '../queues/notification.queue.js';
import { prisma } from '../db/prisma.js';
import type { JobsOptions } from 'bullmq';

export interface QueueNotificationData {
  notificationId: string;
  recipient: string;
  channel: 'email' | 'sms';
  templateId: string;
  payloadData: Record<string, unknown>;
}

/** One deterministic job ID per DB notification. */
export async function addNotificationJob(
  data: QueueNotificationData, options: Pick<JobsOptions, 'delay' | 'priority'>,
): Promise<void> {
  const existing = await notificationQueue.getJob(data.notificationId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') {
      await existing.remove();
    } else {
      // Waiting, delayed and active jobs are already scheduled.
      return;
    }
  }
  await notificationQueue.add('dispatch', data, {
    jobId: data.notificationId, delay: options.delay ?? 0, priority: options.priority ?? 0,
  });
}

/** Recover only stale queued records, not processing records whose delivery is ambiguous.
 * A live processor marks status=processing before contacting any provider.
 */
export async function recoverQueuedNotifications(limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - 120_000);
  const pending = await prisma.notification.findMany({
    where: { status: 'queued', updated_at: { lt: cutoff } },
    orderBy: { updated_at: 'asc' },
    take: Math.max(1, Math.min(100, limit)),
  });
  let repaired = 0;
  for (const row of pending) {
    const existing = await notificationQueue.getJob(row.id);
    if (existing) continue;
    // Only the DB record is authoritative about the user's intended delivery.
    await addNotificationJob({
      notificationId: row.id, recipient: row.recipient,
      channel: row.channel as 'email' | 'sms', templateId: row.template_id,
      payloadData: row.payload_data as Record<string, unknown>,
    }, {
      delay: row.scheduled_for ? Math.max(0, row.scheduled_for.getTime() - Date.now()) : 0,
      priority: row.priority,
    });
    repaired++;
  }
  return repaired;
}
