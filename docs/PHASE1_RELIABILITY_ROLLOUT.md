# Phase 1 delivery reliability — rollout and operational runbook

Status: **draft, NOT a production launch approval**. The source compiles in CI, but the
staging Postgres/Redis fault-injection suite and managed Redis persistence check
are required before enabling production traffic.

## Release order (expand first)
1. Apply the two additive Prisma migrations in order on an isolated staging DB;
   verify the existing five statuses and legacy notification rows remain intact.
2. Run `npx prisma generate && npm run build && npm test`. For DB concurrency
   tests, use an isolated migrated staging database and
   `RUN_DB_TESTS=1 DATABASE_URL=... npm test`. Never use production credentials.
3. Test the new worker with both old full-payload jobs and ID-only jobs. Check
   accepted, 421, 550, SMTP timeout during DATA, expired, suppressed, and worker
   crash after SMTP accepts.
4. Deploy Notification Service first. The container entrypoint runs migrations
   before API/worker boot. Monitor outbox age, queue depth, dead letters, DB errors,
   and unknown delivery claims.
5. Only after Notification is stable, deploy the Auth Service registration
   outbox PR. Confirm new registrations create one event and one welcome email.
6. Roll back behavior only after all unpublished outbox events have drained or
   a compatible relay is left running. Never roll the schema back by dropping
   columns while old/new workers still exist.

## State machine
- `pending`: Postgres notification + outbox event committed, not yet handed to Redis.
- `queued`: relay handed job to Redis; no delivery attempt has begun.
- `processing`: fenced worker claim; attempt is recorded before provider call.
- `retry_scheduled`: provider transient failure; BullMQ exponential retry pending.
- `sent`: SMTP provider accepted message (NOT inbox-delivered).
- `unknown`: SMTP acceptance uncertain; manual reconciliation or explicit replay.
- `dead_letter`: permanent failure or retries exhausted.
- `expired`, `cancelled`, `suppressed`: terminal, never send.
- `failed`: legacy status, still recognized as retryable; remove in contract phase.

## Operational endpoints
- `GET /api/v1/notifications/:id`: requires application `X-API-Key`.
- `POST /api/v1/notifications/:id/cancel`: same auth; pending/queued only.
- `POST /api/v1/dashboard/applications/:appId/notifications/:id/replay`:
  bearer Auth Service access token and application admin permission.
  Body: `{"reason":"Documented operator reason","acceptDuplicateRisk":true}`.
  The risk acknowledgement is mandatory for `unknown` and records an audit row.
- `GET /api/v1/dashboard/applications/:appId/notifications/:id/attempts`:
  admin-only delivery attempt history, with no raw SMTP message or payload.
- `GET /metrics`: bearer token `METRICS_BEARER_TOKEN`. No token means 403.

## Configuration
- `CORS_ALLOWED_ORIGINS`: optional comma-separated browser origins;
  a missing value means same-origin dashboard only; backend-to-backend traffic
  does not require CORS.
- `METRICS_BEARER_TOKEN`: required before scraping /metrics. Store as Render
  secret; use a long random value.
- `UNKNOWN_OUTCOME_RESEND_TEMPLATES`: opt-in comma-separated template slugs.
  Default is NOT to auto-resend unknown SMTP outcomes.
- `REDIS_URL`: optional; prefer `rediss://` with TLS for externally hosted
  Redis, or retain private `REDIS_HOST`/`REDIS_PORT` configuration.

## Critical operational blockers
1. Live Render `notification-redis` currently has `maxmemoryPolicy=noeviction`
   but `persistenceMode=off` (verified November 19, 2026). Enable supported
   persistent Redis storage or migrate to a durable service and rehearse restart
   recovery before production signoff. Persistence or plan changes may incur cost:
   obtain approval before modifying.
2. There is no dedicated staging stack / sandbox SMTP fault-injection result
   recorded for this PR. Unit tests and TypeScript do not prove exact recovery.
3. The tenant-specific Auth registration path writes users to per-tenant DBs and
   still uses best-effort notification dispatch. Separate tenant-local outbox
   migrations and a tenant-aware relay are required for complete coverage.
4. Failed deliveries due to SMTP accepting a message and Postgres being down
   after acceptance enter `unknown`, not automatic resend.
5. Legacy bootstrap jobs may exist without a rendered snapshot in Postgres; the
   worker falls back to the job's embedded rendered email in that case.

## Incident SQL
```sql
SELECT count(*) FROM "notification_outbox" WHERE "published_at" IS NULL;
SELECT min("created_at") FROM "notification_outbox" WHERE "published_at" IS NULL;
SELECT status, count(*) FROM "Notification" GROUP BY status ORDER BY status;
SELECT id, status, locked_until FROM "Notification"
 WHERE status='processing' AND locked_until < now();
```

## Fault-injection exit gate
- 20 parallel same-key sends → exactly one notification/outbox insert.
- Same key/different payload → HTTP 409.
- Kill worker before and after SMTP acceptance → no automatic duplicate for
  unknown outcome, ledger and reaper correctly record uncertainty.
- Stop Redis after DB commit → API still returns 202; relay eventually publishes.
- Restart/lose Redis → sweeper detects stale queued jobs.
- Drop DB while provider accepts → sender does not trigger a blind resend.
- Test legacy jobs, revocation, application isolation and audited replay.
