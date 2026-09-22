import { Worker, UnrecoverableError } from 'bullmq';
import { ENV } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { EmailProvider } from '../providers/email.provider.js';
import { SmsProvider } from '../providers/sms.provider.js';
import { notificationsProcessed, notificationDeliveryDuration, } from '../metrics.js';
const emailProvider = new EmailProvider();
const smsProvider = new SmsProvider();
export function startNotificationWorker() {
    const worker = new Worker('notifications-standard', async (job) => {
        const { notificationId, recipient, channel, templateId, payloadData } = job.data;
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
        let result;
        if (channel === 'email') {
            result = await emailProvider.send({ recipient, templateId, payloadData });
        }
        else if (channel === 'sms') {
            result = await smsProvider.send({ recipient, templateId, payloadData });
        }
        else {
            stopTimer();
            // Unknown channel will never succeed on retry.
            throw new UnrecoverableError(`Unsupported channel: ${channel}`);
        }
        stopTimer();
        if (!result.success) {
            throw new Error(result.error || 'Delivery failed');
        }
        await prisma.notification.update({
            where: { id: notificationId },
            data: { status: 'sent' },
        });
        notificationsProcessed.inc({ channel, outcome: 'sent' });
    }, {
        connection: { host: ENV.REDIS_HOST, port: ENV.REDIS_PORT },
        concurrency: 5,
    });
    worker.on('failed', async (job, err) => {
        if (!job)
            return;
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
                    error_log: { message: err.message, stack: err.stack },
                },
            });
            notificationsProcessed.inc({ channel, outcome: 'dead_letter' });
        }
        else {
            // Transient failure; a retry is still pending.
            await prisma.notification.update({
                where: { id: job.data.notificationId },
                data: { status: 'failed', error_log: { message: err.message } },
            });
        }
    });
    worker.on('error', (err) => {
        console.error('Worker error:', err);
    });
    console.log('🚀 Notification background worker running.');
    return worker;
}
//# sourceMappingURL=notification.worker.js.map