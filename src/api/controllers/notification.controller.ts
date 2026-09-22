import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notificationQueue } from '../../queues/notification.queue.js';
import { notificationsEnqueued } from '../../metrics.js';
import type { SendNotificationInput } from '../middleware/validate.middleware.js';

export const sendNotification = async (req: Request, res: Response): Promise<void> => {
  const { recipient, channel, templateId, payloadData, idempotencyKey, priority, scheduledFor } =
    req.body as SendNotificationInput;
  const callerService = (req.headers['x-caller-service'] as string) || 'default-service';

  const resolvedIdempotencyKey =
    idempotencyKey ||
    crypto
      .createHash('sha256')
      .update(`${recipient}:${channel}:${templateId}:${JSON.stringify(payloadData)}`)
      .digest('hex');

  const existing = await prisma.notification.findUnique({
    where: { idempotency_key: resolvedIdempotencyKey },
  });

  // A record that is still in-flight or already delivered is a true idempotent hit.
  if (existing && existing.status !== 'failed' && existing.status !== 'dead_letter') {
    res.status(200).json({
      message: 'Idempotent match: Request already handled',
      notificationId: existing.id,
      status: existing.status,
    });
    return;
  }

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const normalizedPriority = priority ?? 0;

  // Reset an existing failed/dead_letter record instead of inserting a duplicate
  // (idempotency_key is @unique, so a second create would throw P2002).
  const auditRecord = existing
    ? await prisma.notification.update({
        where: { id: existing.id },
        data: {
          recipient,
          channel,
          template_id: templateId,
          payload_data: payloadData,
          status: 'queued',
          attempts: 0,
          priority: normalizedPriority,
          scheduled_for: scheduledDate,
          caller_service: callerService,
          error_log: Prisma.JsonNull,
        },
      })
    : await prisma.notification.create({
        data: {
          idempotency_key: resolvedIdempotencyKey,
          recipient,
          channel,
          template_id: templateId,
          payload_data: payloadData,
          status: 'queued',
          priority: normalizedPriority,
          scheduled_for: scheduledDate,
          caller_service: callerService,
        },
      });

  const delay = scheduledDate ? scheduledDate.getTime() - Date.now() : 0;
  await notificationQueue.add(
    'dispatch',
    { notificationId: auditRecord.id, recipient, channel, templateId, payloadData },
    { delay: delay > 0 ? delay : 0, priority: normalizedPriority }
  );

  notificationsEnqueued.inc({ channel });

  res.status(202).json({
    message: 'Notification enqueued successfully',
    notificationId: auditRecord.id,
    status: 'queued',
  });
};
