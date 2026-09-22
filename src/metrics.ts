import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const notificationsProcessed = new client.Counter({
  name: 'notifications_processed_total',
  help: 'Total notifications processed by the worker, labeled by channel and outcome',
  labelNames: ['channel', 'outcome'] as const,
  registers: [registry],
});

export const notificationDeliveryDuration = new client.Histogram({
  name: 'notification_delivery_duration_seconds',
  help: 'Time spent delivering a notification through a provider',
  labelNames: ['channel'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const notificationsEnqueued = new client.Counter({
  name: 'notifications_enqueued_total',
  help: 'Total notifications accepted by the API and enqueued',
  labelNames: ['channel'] as const,
  registers: [registry],
});
