import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';

export const notificationQueue = new Queue('notifications-standard', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    // PostgreSQL is the authority; a removed BullMQ job ID is not an idempotency guard.
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});
