import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ENV } from './config/env.js';
import { notificationRoutes } from './api/routes/notification.routes.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { prisma } from './db/prisma.js';
import { registry } from './metrics.js';
import { notificationQueue } from './queues/notification.queue.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

app.get('/ready', async (_req: Request, res: Response) => {
  try {
    // Both persistent storage and job queue must work for notification delivery.
    await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      notificationQueue.client.then(async (redis) => {
        const reply = await redis.ping();
        if (reply !== 'PONG') throw new Error('Redis PING failed');
      }),
    ]);
    res.status(200).json({ status: 'READY', database: 'connected', queue: 'connected' });
  } catch (err) {
    // Details remain server-side; never leak connection strings or internals.
    console.error('[readiness] Dependency check failed:', err);
    res.status(503).json({ status: 'NOT_READY', error: 'Dependency unavailable' });
  }
});

app.get('/metrics', async (_req: Request, res: Response) => {
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
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
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
