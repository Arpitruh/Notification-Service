import { Worker, UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { allowUnknownResend, classifyDelivery, safeDeliveryError } from '../services/delivery-policy.js';
import { prisma } from '../db/prisma.js';
import { EmailProvider } from '../providers/email.provider.js';
import { SmsProvider } from '../providers/sms.provider.js';
import type { DeliveryResult } from '../providers/email.provider.js';
import { TemplateError } from '../services/template-renderer.js';
import {
  notificationsProcessed,
  notificationDeliveryDuration,
} from '../metrics.js';

const emailProvider = new EmailProvider();
const smsProvider = new SmsProvider();

interface NotificationJobData {
  notificationId: string;
  recipient: string;
  channel: 'email' | 'sms' | 'push';
  templateId: string;
  payloadData: Record<string, unknown>;
  renderedEmail?: { subject: string; html: string };
}

export function startNotificationWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    'notifications-standard',
    async (job: Job<NotificationJobData>) => {
      const { notificationId, recipient, channel, templateId, payloadData, renderedEmail } = job.data;

      // attemptsMade is 0 on the first run; present it as a 1-based attempt count.
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'processing', attempts: job.attemptsMade + 1 },
      });

      const suppressed = await prisma.suppression.findUnique({
        where: { recipient_channel: { recipient, channel } },
      });

      if (suppressed) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'dead_letter', error_log: { error: 'Recipient is suppressed' } },
        });
        notificationsProcessed.inc({ channel, outcome: 'suppressed' });
        // Suppression is terminal; do not retry.
        return;
      }

      const stopTimer = notificationDeliveryDuration.startTimer({ channel });
      let result: DeliveryResult;
      if (channel === 'email') {
        try {
          result = renderedEmail
            ? await emailProvider.sendRendered(recipient, renderedEmail, { idempotencyId: notificationId })
            : await emailProvider.send({ recipient, templateId, payloadData }, { idempotencyId: notificationId });
        } catch (err) {
          stopTimer();
          // A template problem will never succeed on retry; fail permanently.
          if (err instanceof TemplateError) {
            throw new UnrecoverableError(err.message);
          }
          throw err;
        }
      } else if (channel === 'sms') {
        result = await smsProvider.send({ recipient, templateId, payloadData });
      } else {
        stopTimer();
        // Unknown channel will never succeed on retry.
        throw new UnrecoverableError(`Unsupported channel: ${channel}`);
      }
      stopTimer();

      if (!result.success) {
        const decision = classifyDelivery(result);
        const code = result.errorCode || 'PROVIDER_FAILURE';
        const message = safeDeliveryError(result.error || 'Delivery failed');
        // The SMTP server might have accepted the message before the timeout.
        if (decision === 'unknown' && !allowUnknownResend(templateId)) {
          throw new UnrecoverableError('SMTP_UNKNOWN_OUTCOME: manual reconciliation required');
        }
        if (decision === 'permanent') throw new UnrecoverableError(code + ': ' + message);
        throw new Error(code + ': ' + message);
      }

      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'sent' },
      });
      notificationsProcessed.inc({ channel, outcome: 'sent' });
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    try {

    const maxAttempts = job.opts.attempts ?? 1;
    const isUnrecoverable = err instanceof UnrecoverableError;
    const exhausted = job.attemptsMade >= maxAttempts;

    // Move to dead_letter when retries are exhausted or the error is unrecoverable.
    if (exhausted || isUnrecoverable) {
      const { notificationId, channel } = job.data;
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'dead_letter',
          error_log: { code: err.name, message: safeDeliveryError(err.message) },
        },
      });
      notificationsProcessed.inc({ channel, outcome: 'dead_letter' });
    } else {
      // Transient failure; a retry is still pending.
      await prisma.notification.update({
        where: { id: job.data.notificationId },
        data: { status: 'failed', error_log: { code: err.name, message: safeDeliveryError(err.message) } },
      });
    }
    } catch (dbErr) {
      // The worker and API currently share a process; never create an
      // unhandled rejection from an async EventEmitter listener.
      console.error('[notification-worker] Failed to persist retry state:', dbErr);
    }
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  console.log('🚀 Notification background worker running.');
  return worker;
}
