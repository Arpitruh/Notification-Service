ALTER TABLE "Application"
  ADD COLUMN "dashboard_url" TEXT,
  ADD COLUMN "welcome_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "welcome_template" TEXT NOT NULL DEFAULT 'welcome';

CREATE TABLE "ApplicationCredential" (
  "id" TEXT PRIMARY KEY,
  "application_id" TEXT NOT NULL REFERENCES "Application"("id") ON DELETE CASCADE,
  "key_hash" TEXT NOT NULL UNIQUE,
  "prefix" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3)
);
CREATE INDEX "ApplicationCredential_application_id_idx" ON "ApplicationCredential"("application_id");
