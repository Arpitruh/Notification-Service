import { Queue } from 'bullmq';
import { ENV } from '../config/env.js';

export const notificationQueue = new Queue('notifications-standard', {
  connection: { host: ENV.REDIS_HOST, port: ENV.REDIS_PORT },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});