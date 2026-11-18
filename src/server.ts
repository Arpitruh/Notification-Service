import { createApp } from './app.js';
import { recoverQueuedNotifications } from './services/queue-recovery.js';
import { ENV } from './config/env.js';
import { notificationQueue } from './queues/notification.queue.js';
import { closeClientQuotaLimiter } from './api/middleware/client-quota.middleware.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { prisma } from './db/prisma.js';

const app = createApp();
const worker = startNotificationWorker();
// Reconcile queued audit records that lost a Redis job after a process crash.
const recoveryTimer = setInterval(() => {
  void recoverQueuedNotifications().catch(() => console.error('Queue reconciliation failed'));
}, 60_000);
recoveryTimer.unref();

const server = app.listen(ENV.PORT, () => {
  console.info('Notification Service listening on port', ENV.PORT);
});

let closing = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(recoveryTimer);
  console.info('Graceful shutdown started', signal);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  server.close(async () => {
    try {
      await worker.close();
      await notificationQueue.close();
      closeClientQuotaLimiter();
      await prisma.$disconnect();
      clearTimeout(timeout);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
