import crypto from 'node:crypto';
import { Worker, UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { prisma } from '../db/prisma.js';
import { redisConnection } from '../config/redis.js';
import { EmailProvider } from '../providers/email.provider.js';
import { SmsProvider } from '../providers/sms.provider.js';
import { TemplateError } from '../services/template-renderer.js';
import { allowUnknownResend, classifyDelivery, safeDeliveryError } from '../services/delivery-policy.js';
import { notificationsProcessed, notificationDeliveryDuration } from '../metrics.js';

type Payload = {
  notificationId: string;
  outboxId?: string;
  recipient?: string;
  channel?: 'email' | 'sms' | 'push';
  templateId?: string;
  payloadData?: Record<string, unknown>;
  renderedEmail?: { subject: string; html: string };
};

const terminal = ['sent', 'dead_letter', 'expired', 'cancelled', 'suppressed', 'unknown'];
const emailProvider = new EmailProvider();
const smsProvider = new SmsProvider();

/** One execution gets a unique fence, even if BullMQ re-delivers the same job ID. */
async function finish(id: string, fence: string, status: 'sent'|'retry_scheduled'|'dead_letter'|'expired'|'suppressed'|'unknown',
  extra: { error_log?: object; provider_message_id?: string } = {}): Promise<boolean> {
  const changed = await prisma.notification.updateMany({
    where: { id, status: 'processing', locked_by: fence },
    data: { status, locked_by: null, locked_until: null, ...extra },
  });
  return changed.count === 1;
}

async function processJob(job: Job<Payload>): Promise<void> {
  const id = job.data.notificationId;
  const fence = crypto.randomUUID();
  const claim = await prisma.notification.updateMany({
    where: {
      id,
      status: { in: ['queued', 'pending', 'failed', 'retry_scheduled'] },
    },
    data: {
      status: 'processing',
      locked_by: fence,
      locked_until: new Date(Date.now() + 5 * 60_000),
      attempts: job.attemptsMade + 1,
    },
  });
  if (!claim.count) {
    const n = await prisma.notification.findUnique({ where: { id }, select: { status: true } });
    if (!n) throw new UnrecoverableError('Unknown notification ID');
    if (terminal.includes(n.status)) return;
    // Processing is owned by another live worker. Do not send twice. A reaper
    // handles expired claims; a same-ID BullMQ stall must not steal the lease.
    if (n.status === 'processing') return;
    throw new Error('Notification claim not available');
  }

  const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
  const channel = n.channel;
  const templateId = n.template_id;
  const recipient = n.recipient;
  const payloadData = n.payload_data as Record<string, unknown>;
  const renderedEmail = (n.rendered_email as { subject: string; html: string } | null) ?? job.data.renderedEmail;

  // A previously started attempt has an uncertain outcome after a crash.
  const orphans = await prisma.notificationAttempt.updateMany({
    where: { notification_id: id, outcome: 'started', finished_at: null },
    data: { outcome: 'unknown', retryable: false,
      error_code: 'PREVIOUS_ATTEMPT_INTERRUPTED', finished_at: new Date() },
  });
  if (orphans.count && !allowUnknownResend(templateId)) {
    await finish(id, fence, 'unknown', { error_log: { code: 'PREVIOUS_ATTEMPT_INTERRUPTED' } });
    notificationsProcessed.inc({ channel, outcome: 'unknown' });
    return;
  }

  if (n.expires_at && n.expires_at <= new Date()) {
    await finish(id, fence, 'expired');
    notificationsProcessed.inc({ channel, outcome: 'expired' });
    return;
  }
  if (await prisma.suppression.findUnique({ where: { recipient_channel: { recipient, channel } } })) {
    await finish(id, fence, 'suppressed');
    notificationsProcessed.inc({ channel, outcome: 'suppressed' });
    return;
  }

  const attempt = await prisma.notificationAttempt.create({
    data: { notification_id: id, attempt_number: job.attemptsMade + 1,
      provider: channel === 'email' ? 'smtp' : channel, outcome: 'started' },
  });
  const stopTimer = notificationDeliveryDuration.startTimer({ channel });
  let result: import('../providers/email.provider.js').DeliveryResult;
  try {
    if (channel === 'email') {
      const options = { idempotencyId: id };
      result = renderedEmail
        ? await emailProvider.sendRendered(recipient, renderedEmail, options)
        : await emailProvider.send({ recipient, templateId, payloadData }, options);
    } else if (channel === 'sms') {
      result = await smsProvider.send({ recipient, templateId, payloadData });
    } else {
      throw new UnrecoverableError('Unsupported notification channel');
    }
  } catch (error) {
    result = error instanceof TemplateError || error instanceof UnrecoverableError
      ? { success: false, error: error.message, errorCode: 'PERMANENT_ERROR', retryable: false }
      : { success: false, error: error instanceof Error ? error.message : 'Provider error', retryable: true };
  } finally { stopTimer(); }

  if (result.success) {
    try {
      // Both updates in one transaction; never mark a notification sent unless
      // the ledger entry was persisted as accepted.
      await prisma.$transaction(async tx => {
        await tx.notificationAttempt.update({ where: { id: attempt.id },
          data: { outcome: 'accepted', ...(result.providerMessageId ? { provider_message_id: result.providerMessageId } : {}),
            finished_at: new Date() } });
        const updated = await tx.notification.updateMany({
          where: { id, status: 'processing', locked_by: fence },
          data: { status: 'sent', locked_by: null, locked_until: null,
            ...(result.providerMessageId ? { provider_message_id: result.providerMessageId } : {}) },
        });
        if (!updated.count) throw new Error('Lost delivery claim after provider acceptance');
      });
      notificationsProcessed.inc({ channel, outcome: 'sent' });
    } catch (err) {
      // SMTP may have accepted the message; never trigger another send just
      // because Postgres became unavailable after acceptance.
      console.error('[notification-worker] provider accepted, DB persistence failed', id);
      throw new UnrecoverableError('ACCEPTED_UNCONFIRMED: manual reconciliation required');
    }
    return;
  }

  const policy = classifyDelivery(result);
  const errorCode = result.errorCode ?? 'PROVIDER_FAILURE';
  const errorText = safeDeliveryError(result.error ?? 'Provider reported failure');
  const unknown = policy === 'unknown';
  const retry = policy === 'retry' || (unknown && allowUnknownResend(templateId));
  const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  const outcome = unknown ? 'unknown' : retry ? 'transient_failure' : 'permanent_failure';
  const nextStatus = unknown && !retry ? 'unknown' : retry && !exhausted ? 'retry_scheduled' : 'dead_letter';
  await prisma.$transaction(async tx => {
    await tx.notificationAttempt.update({
      where: { id: attempt.id },
      data: { outcome, retryable: retry, error_code: errorCode,
        error_message: errorText, finished_at: new Date() },
    });
    await tx.notification.updateMany({
      where: { id, status: 'processing', locked_by: fence },
      data: { status: nextStatus, locked_by: null, locked_until: null,
        error_log: { code: errorCode, message: errorText } },
    });
  });
  if (nextStatus === 'unknown') {
    notificationsProcessed.inc({ channel, outcome: 'unknown' });
    return;
  }
  if (nextStatus === 'dead_letter') {
    notificationsProcessed.inc({ channel, outcome: 'dead_letter' });
    return;
  }
  throw new Error('TRANSIENT_PROVIDER_FAILURE: retry scheduled');
}

export function startNotificationWorker(): Worker<Payload> {
  const worker = new Worker<Payload>('notifications-standard', processJob,
    { connection: redisConnection, concurrency: 5 });
  worker.on('failed', (job, err) => {
    // Retry state is updated in processJob, never here; async listener cannot
    // create an unhandled rejection and crash the combined API/worker process.
    console.error('[notification-worker] job failed', job?.id, safeDeliveryError(err.message));
  });
  worker.on('error', error => console.error('[notification-worker] worker error', error));
  return worker;
}

/** Claims whose worker died are unknown until reconciled, not blindly resent. */
export async function reapExpiredDeliveryClaims(): Promise<number> {
  const legacyCutoff = new Date(Date.now() - 10 * 60_000);
  const stale = await prisma.notification.findMany({
    where: {
      status: 'processing',
      OR: [
        { locked_by: { not: null }, locked_until: { lt: new Date() } },
        // Old pre-Phase-1 workers never stamped a lease. Do not auto-resend
        // an interrupted SMTP request; classify stale legacy rows as unknown.
        { locked_by: null, updated_at: { lt: legacyCutoff } },
      ],
    },
    select: { id: true, locked_by: true },
    take: 50,
  });
  let count = 0;
  for (const n of stale) {
    const changed = await prisma.notification.updateMany({
      where: n.locked_by
        ? { id: n.id, status: 'processing', locked_by: n.locked_by,
            locked_until: { lt: new Date() } }
        : { id: n.id, status: 'processing', locked_by: null,
            updated_at: { lt: legacyCutoff } },
      data: { status: 'unknown', locked_by: null, locked_until: null,
        error_log: { code: 'DELIVERY_LEASE_EXPIRED' } },
    });
    if (!changed.count) continue;
    await prisma.notificationAttempt.updateMany({
      where: { notification_id: n.id, outcome: 'started', finished_at: null },
      data: { outcome: 'unknown', retryable: false,
        error_code: 'DELIVERY_LEASE_EXPIRED', finished_at: new Date() },
    });
    count++;
  }
  return count;
}
