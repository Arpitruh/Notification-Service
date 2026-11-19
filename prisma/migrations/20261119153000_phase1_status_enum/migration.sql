-- Expand enum values first; PostgreSQL requires new enum labels to be committed
-- before they can be used in data writes.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'retry_scheduled';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'suppressed';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'unknown';
CREATE TYPE "AttemptOutcome" AS ENUM ('started','accepted','transient_failure','permanent_failure','unknown');
