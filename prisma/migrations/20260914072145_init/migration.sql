-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'sms', 'push');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'processing', 'sent', 'failed', 'dead_letter');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "template_id" TEXT NOT NULL,
    "payload_data" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMP(3),
    "caller_service" TEXT NOT NULL,
    "error_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotency_key_key" ON "Notification"("idempotency_key");

-- CreateIndex
CREATE INDEX "Notification_idempotency_key_idx" ON "Notification"("idempotency_key");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_recipient_channel_key" ON "Suppression"("recipient", "channel");
