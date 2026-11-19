-- Additive phase-1 migration: no existing row or notification status is rewritten.
ALTER TABLE "Notification"
  ADD COLUMN "application_id" TEXT,
  ADD COLUMN "payload_hash" TEXT,
  ADD COLUMN "rendered_email" JSONB,
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "locked_by" TEXT,
  ADD COLUMN "locked_until" TIMESTAMP(3);
CREATE INDEX "Notification_status_scheduled_for_idx" ON "Notification"("status","scheduled_for");
CREATE INDEX "Notification_application_id_created_at_idx" ON "Notification"("application_id","created_at");
CREATE TABLE "notification_outbox" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_until" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_outbox_published_at_next_attempt_at_idx" ON "notification_outbox"("published_at","next_attempt_at");
CREATE INDEX "notification_outbox_notification_id_idx" ON "notification_outbox"("notification_id");
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "notification_attempt" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "outcome" "AttemptOutcome" NOT NULL DEFAULT 'started',
  "retryable" BOOLEAN,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "notification_attempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_attempt_notification_id_started_at_idx" ON "notification_attempt"("notification_id","started_at");
ALTER TABLE "notification_attempt" ADD CONSTRAINT "notification_attempt_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
