import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../../config/env.js';
import {
  parseNotificationClients, resolveNotificationClient, safeKeyEquals,
  type NotificationClient,
} from '../../lib/client-auth.js';

const clients = parseNotificationClients(ENV.NOTIFICATION_CLIENTS_JSON);
if (ENV.METRICS_API_KEY && ENV.METRICS_API_KEY.length < 32) {
  throw new Error('METRICS_API_KEY must contain at least 32 characters.');
}

export function requireNotificationClient(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  if (!clients.length) {
    res.status(503).json({ error: 'Notification clients have not been configured.' });
    return;
  }
  const client = resolveNotificationClient(req.header('x-notification-api-key'), clients);
  if (!client) {
    res.status(401).json({ error: 'Invalid service credentials.' });
    return;
  }
  res.locals.notificationClient = client;
  next();
}

export function requireClientPermission(req: Request, res: Response, next: NextFunction): void {
  const client = res.locals.notificationClient as NotificationClient | undefined;
  if (!client) { res.status(401).json({ error: 'Unauthenticated' }); return; }
  const body = req.body as { channel: 'email' | 'sms'; templateId: string };
  if (!client.channels.includes(body.channel) ||
      (client.templates && !client.templates.includes(body.templateId))) {
    res.status(403).json({ error: 'This client is not permitted to use that channel or template.' });
    return;
  }
  // A production SMS must use the real Twilio provider, not the dev mock.
  if (body.channel === 'sms' && process.env.NODE_ENV === 'production' &&
      (!ENV.TWILIO.accountSid || !ENV.TWILIO.authToken || !ENV.TWILIO.phoneNumber)) {
    res.status(503).json({ error: 'SMS provider is not configured.' });
    return;
  }
  next();
}

export function requireMetricsKey(req: Request, res: Response, next: NextFunction): void {
  if (!ENV.METRICS_API_KEY) { res.status(404).end(); return; }
  if (!safeKeyEquals(req.header('x-metrics-api-key'), ENV.METRICS_API_KEY)) {
    res.status(401).json({ error: 'Invalid metrics credentials.' });
    return;
  }
  next();
}
