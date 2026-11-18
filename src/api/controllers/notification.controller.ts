import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { addNotificationJob } from '../../services/queue-recovery.js';
import { notificationsEnqueued } from '../../metrics.js';
import type { SendNotificationInput } from '../middleware/validate.middleware.js';
import type { NotificationClient } from '../../lib/client-auth.js';
import { sameNotificationIntent, scopedIdempotencyKey } from '../../lib/idempotency.js';

function isUniqueConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null &&
    'code' in err && (err as { code?: unknown }).code === 'P2002';
}

/** Authenticated, caller-scoped and retry-safe enqueue API. */
export const sendNotification = async (req: Request, res: Response): Promise<void> => {
  const caller = res.locals.notificationClient as NotificationClient;
  const { recipient, channel, templateId, payloadData, idempotencyKey, priority, scheduledFor } =
    req.body as SendNotificationInput;

  // Without an explicit caller-provided key, every request is intentional.
  // Apps that retry on network failures MUST provide an idempotencyKey.
  const scopedKey = scopedIdempotencyKey(caller.id, idempotencyKey);
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const normalizedPriority = priority ?? 0;
  const intent = { recipient, channel, templateId, payloadData, priority: normalizedPriority, scheduledFor: scheduledDate };

  const existing = await prisma.notification.findUnique({
    where: { idempotency_key: scopedKey },
  });
  if (existing && !sameNotificationIntent(existing, intent)) {
    res.status(409).json({ error: 'Idempotency key was already used for a different notification.' });
    return;
  }
  if (existing && existing.status !== 'failed' && existing.status !== 'dead_letter') {
    res.status(200).json({
      message: 'Idempotent match: Request already accepted',
      notificationId: existing.id,
      status: existing.status,
    });
    return;
  }

  let notificationId: string;
  if (existing) {
    // Only one caller can claim a failed/dead-letter record for retry.
    const retried = await prisma.notification.updateMany({
      where: { id: existing.id, status: { in: ['failed', 'dead_letter'] } },
      data: { status: 'queued', attempts: 0, error_log: Prisma.JsonNull },
    });
    if (!retried.count) {
      res.status(200).json({ message: 'Retry already accepted', notificationId: existing.id, status: 'queued' });
      return;
    }
    notificationId = existing.id;
  } else {
    try {
      const record = await prisma.notification.create({
        data: {
          idempotency_key: scopedKey,
          recipient, channel, template_id: templateId, payload_data: payloadData,
          status: 'queued', priority: normalizedPriority, scheduled_for: scheduledDate,
          caller_service: caller.id, // Verified identity, never an untrusted request header.
        },
      });
      notificationId = record.id;
    } catch (err) {
      // Concurrent request won the unique key race. Do not enqueue twice.
      if (!isUniqueConflict(err)) throw err;
      const raced = await prisma.notification.findUnique({ where: { idempotency_key: scopedKey } });
      if (!raced) throw err;
      if (!sameNotificationIntent(raced, intent)) {
        res.status(409).json({ error: 'Idempotency key was already used for a different notification.' });
        return;
      }
      res.status(200).json({ message: 'Idempotent match: Request already accepted', notificationId: raced.id, status: raced.status });
      return;
    }
  }

  const delay = scheduledDate ? Math.max(0, scheduledDate.getTime() - Date.now()) : 0;
  try {
    await addNotificationJob(
      { notificationId, recipient, channel, templateId, payloadData },
      { delay, priority: normalizedPriority },
    );
  } catch {
    await prisma.notification.updateMany({
      where: { id: notificationId, status: 'queued' },
      data: { status: 'failed', error_log: { reason: 'QUEUE_UNAVAILABLE' } },
    });
    res.status(503).json({ error: 'Notification queue unavailable; retry using the same idempotencyKey.' });
    return;
  }

  notificationsEnqueued.inc({ channel });
  res.status(202).json({ message: 'Notification enqueued', notificationId, status: 'queued' });
};

/** Poll one job's safe status. An unrelated client receives the same 404 as an unknown ID. */
export const getNotificationStatus = async (req: Request, res: Response): Promise<void> => {
  const caller = res.locals.notificationClient as NotificationClient;
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) { res.status(404).json({ error: 'Notification not found.' }); return; }
  const notification = await prisma.notification.findFirst({
    where: { id, caller_service: caller.id },
    select: {
      id: true, status: true, channel: true, template_id: true, attempts: true,
      created_at: true, updated_at: true, scheduled_for: true,
    },
  });
  if (!notification) { res.status(404).json({ error: 'Notification not found.' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ notification });
};
