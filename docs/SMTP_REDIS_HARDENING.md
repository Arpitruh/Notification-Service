# SMTP + Redis production hardening (incremental PR)

This patch is designed for the **existing** Notification Service deployment. It does **not** install the Phase 1 outbox/attempt-ledger schema changes in the draft ZIPs.

## Configuration
- `REDIS_URL` (optional): Prefer `rediss://user:password@host:6380/0` for remote production Redis. When omitted, existing `REDIS_HOST`/`REDIS_PORT` continues to work for the private Render instance.
- Redis server: configure `maxmemory-policy noeviction`, persistence/AOF, backups and alerts **on the managed Redis instance**; application code cannot guarantee server persistence.
- `UNKNOWN_OUTCOME_RESEND_TEMPLATES` (optional): Comma-separated exact template slugs (for example `otp,password-reset`). Only these templates are retried when SMTP may have accepted a message before a connection failure. Default: no automatic resend after an ambiguous outcome. Use this only for messages whose duplicate delivery is acceptable.

## SMTP errors
- SMTP 400-499: transient and retryable using existing BullMQ 3-attempt exponential backoff.
- SMTP 500-599, authentication error (EAUTH), invalid address/message: permanent; stop retrying.
- Socket reset/timeouts before DATA: retryable.
- Socket reset/timeouts during DATA: **unknown acceptance**. By default the worker marks the current legacy notification dead_letter with a clear `SMTP_UNKNOWN_OUTCOME` code for manual reconciliation; Phase 1 state-machine migration will introduce a separate `unknown` status.
- Unknown/unclassified failures: conservative permanent response; investigate via logs.
- Stable `Message-ID` across retries uses notification UUID; this helps correlation but is *not* an exactly-once guarantee.

## Important known limitations
- Existing notification controller remains DB-write-then-Redis-queue-add (non-atomic); outbox still needs to be deployed separately.
- Existing worker checks no terminal status before sending; atomic claim/ledger implementation in Phase 1 is needed for full duplicate safety.
- Existing worker writes `failed` during in-flight backoff; caller retry can enqueue a duplicate. Do not treat this patch as completing the full Phase 1 delivery correctness rollout.
- The old schema cannot represent `unknown`; records use `dead_letter` with error code for manual inspection.
- Redis persistence must be enabled at infrastructure level and verified with restart drills.

## Verification
Run `npx prisma generate && npm run build && npm test`. Stage an SMTP 421, 550, EAUTH, and DATA timeout to validate the provider's actual Nodemailer error shape. Verify both Queue and Worker use the same Redis connection, then test queue delivery with a sandbox SMTP receiver.
