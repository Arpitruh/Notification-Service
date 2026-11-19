-- Existing notification records remain valid; new directory and templates are isolated by application.
CREATE TABLE "Application" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ApplicationUser" (
  "id" TEXT PRIMARY KEY,
  "application_id" TEXT NOT NULL REFERENCES "Application"("id") ON DELETE CASCADE,
  "external_id" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationUser_application_id_external_id_key" UNIQUE ("application_id", "external_id")
);
CREATE INDEX "ApplicationUser_application_id_idx" ON "ApplicationUser"("application_id");
CREATE TABLE "MailTemplate" (
  "id" TEXT PRIMARY KEY,
  "application_id" TEXT NOT NULL REFERENCES "Application"("id") ON DELETE CASCADE,
  "slug" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "required_variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailTemplate_application_id_slug_key" UNIQUE ("application_id", "slug")
);
CREATE INDEX "MailTemplate_application_id_idx" ON "MailTemplate"("application_id");
CREATE TABLE "DashboardMembership" (
  "id" TEXT PRIMARY KEY,
  "application_id" TEXT NOT NULL REFERENCES "Application"("id") ON DELETE CASCADE,
  "auth_subject" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardMembership_application_id_auth_subject_key" UNIQUE ("application_id", "auth_subject")
);
CREATE INDEX "DashboardMembership_auth_subject_idx" ON "DashboardMembership"("auth_subject");
CREATE TABLE "DashboardAudit" (
  "id" TEXT PRIMARY KEY,
  "application_id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DashboardAudit_application_id_created_at_idx" ON "DashboardAudit"("application_id", "created_at");
