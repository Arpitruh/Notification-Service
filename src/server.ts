import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { ENV } from './config/env.js';
import { notificationRoutes } from './api/routes/notification.routes.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { prisma } from './db/prisma.js';
import { registry } from './metrics.js';
import { notificationQueue } from './queues/notification.queue.js';
import { requireMetricsKey } from './api/middleware/client-auth.middleware.js';

const app = express();

app.use(helmet());
// Server-to-server only: never allow browser-held API keys via permissive CORS.
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

app.get('/ready', async (_req: Request, res: Response) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, notificationQueue.getJobCounts()]);
    res.status(200).json({ status: 'READY', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'NOT_READY' });
  }
});

app.get('/metrics', requireMetricsKey, async (_req: Request, res: Response) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.use('/api/v1/notifications', notificationRoutes);

// Global error handler. Express 5 forwards rejected async handlers here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

const worker = startNotificationWorker();

const server = app.listen(ENV.PORT, () => {
  console.log(`🚀 Notification Microservice running on port ${ENV.PORT}`);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await worker.close();
    await notificationQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
