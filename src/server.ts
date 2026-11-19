import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ENV } from './config/env.js';
import { notificationRoutes } from './api/routes/notification.routes.js';
import { startNotificationWorker, reapExpiredDeliveryClaims } from './workers/notification.worker.js';
import { startOutboxRelay } from './services/outbox-relay.js';
import { prisma } from './db/prisma.js';
import { registry } from './metrics.js';
import { notificationQueue } from './queues/notification.queue.js';
import { dashboardRoutes } from './api/routes/dashboard.routes.js';
import { dashboardHtml } from './dashboard/page.js';

const app = express();
// Render terminates TLS in front of this service. Trust one proxy hop so
// express-rate-limit uses the forwarded client IP instead of a shared proxy IP.
app.set('trust proxy', 1);

app.use(helmet());
// Browser access is dashboard same-origin; backend callers use API keys and
// do not require broad cross-origin access.
const origins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, done) => {
  if (!origin || origins.includes(origin)) return done(null, true);
  return done(null, false);
} }));
app.use(express.json({ limit: '128kb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

app.get('/ready', async (_req: Request, res: Response) => {
  try {
    // Both persistent storage and job queue must work for notification delivery.
    await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      notificationQueue.getJobCounts(),
    ]);
    res.status(200).json({ status: 'READY', database: 'connected', queue: 'connected' });
  } catch (err) {
    // Details remain server-side; never leak connection strings or internals.
    console.error('[readiness] Dependency check failed:', err);
    res.status(503).json({ status: 'NOT_READY', error: 'Dependency unavailable' });
  }
});

app.get('/metrics', async (req: Request, res: Response) => {
  if (!process.env.METRICS_BEARER_TOKEN || req.header('authorization') !== 'Bearer ' + process.env.METRICS_BEARER_TOKEN) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.get('/', (_req: Request, res: Response) => res.redirect('/dashboard'));
app.get('/dashboard', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'");
  res.type('html').send(dashboardHtml);
});
app.use('/api/v1/dashboard', dashboardRoutes);
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
const relay = startOutboxRelay();
const reaper = setInterval(() => {
  void reapExpiredDeliveryClaims().catch(error => console.error('[reaper] failed', error));
}, 60_000);
reaper.unref();

const server = app.listen(ENV.PORT, () => {
  console.log(`🚀 Notification Microservice running on port ${ENV.PORT}`);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  clearInterval(reaper);
  server.close(async () => {
    try {
      await relay.stop();
      await worker.close();
      await notificationQueue.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error('[shutdown] failed', error);
      process.exitCode = 1;
    }
  });
};

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
