# Notification Platform — implementation roadmap

## Product boundary

One standalone notification platform serving any number of calling applications.
Applications submit notifications with their own credentials. Operators manage
applications, channels, templates, delivery attempts, suppression, and credentials
from a dedicated notification dashboard. Reuse the existing Auth Service for
human dashboard login; do **not** use human sessions to authenticate server-to-server
notification requests.

## Current state and limitations

- Express API, BullMQ worker, Prisma/Postgres, Redis, SMTP email, file templates.
- SMS provider is **mock only**. Push is **not implemented**.
- The current bootstrap API-key map is environment-managed (not dashboard-managed).
- The current idempotency implementation uses an insert/update followed by queue
  insertion; a process crash between the two can strand a queued DB record.
- One web process runs API and worker together; consider splitting once queue
  volume and availability requirements justify it.
- No dashboard, credential rotation UI, audit UI, or provider callbacks yet.

## Target data model

- Application: id, name, slug, status, allowed origins, rate limits, quotas,
  createdAt, updatedAt, owner/permission mappings.
- ApplicationCredential: applicationId, key prefix, hashed secret (never plaintext),
  scopes, createdAt, expiresAt, revokedAt, lastUsedAt. Support overlapping keys for
  zero-downtime rotation; show plaintext exactly once.
- Notification: applicationId FK, channel, recipient, template/version ID, payload,
  idempotency key unique **within application**, requestedAt, scheduledAt, status.
- DeliveryAttempt: notificationId, provider, attempt number, status, provider
  message ID, sanitized error code, latency, timestamps.
- NotificationTemplate: applicationId FK (or explicitly shared global template),
  channel, slug, name, version, subject/body, variables schema, enabled/published
  status, createdBy, updatedBy, archivedAt. Unique app+slug+version; scoped reads.
- ApplicationUser: applicationId FK, externalUserId from the calling application,
  optional verified email/phone, display name, locale, timezone, status,
  createdAt, updatedAt. Unique applicationId+externalUserId; users in one app
  must never be accessible to another. This is a directory of notification
  recipients, **not** a replacement for the application's authentication system.
- UserPreference: applicationUserId, channel, category, optedIn/optedOut,
  preferred language and quiet hours; transactional vs marketing policy.
- DashboardMembership: Auth Service subject ID, applicationId, role
  (owner/admin/editor/viewer), status, invitedAt, acceptedAt. Central platform
  admins are separately scoped; membership changes must be audited.
- ChannelConfiguration: applicationId, channel, provider type, encrypted secret
  reference, enabled flag, verified sender info.
- Suppression: applicationId scope or global scope, recipient/channel, reason.
- AuditEvent: actor, applicationId, resource, action, timestamp, redacted diff.
- WebhookSubscription: applicationId, endpoint, secret hash/encrypted signing secret,
  subscribed events, state, delivery attempt audit.

## Dashboard routes

- /dashboard — cross-application delivery summary, 24h/7d success and failure
  rate, queue depth, provider health.
- /dashboard/applications — create, edit, disable, assign credentials and quotas.
- /dashboard/notifications — filter by app/channel/status/date, view timeline,
  inspect sanitized errors, retry eligible failures.
- /dashboard/templates — select application, list its templates; create, clone,
  edit subject/HTML/plain text, variable schema, live preview, test send, publish,
  archive/remove, restore, version history and rollback. No filesystem edits or
  redeploys for normal template changes. A published template version is
  immutable for in-flight notifications.
- /dashboard/users — choose application, search/add/import/update/deactivate
  recipient users, inspect per-user history, manage channel preferences,
  suppressions and consent. Support users from application API sync as well
  as manual dashboard entry and CSV upload.
- /dashboard/team — invite/remove dashboard operators per application and grant
  owner/admin/editor/viewer roles via Auth Service identities.
- /dashboard/channels — provider setup and verified sender/channel status.
- /dashboard/suppressions — opt-outs, bounces, unblock with audit log.
- /dashboard/webhooks — subscribe, inspect failures, retry deliveries.
- /dashboard/audit — operator actions and application credential changes.
- /dashboard/settings — service configuration and delivery policies.

## Public API

- POST /api/v1/notifications/send — authenticated application, idempotent.
- POST /api/v1/notifications/batch — bounded-size authenticated batch.
- GET /api/v1/notifications/:id — **scoped to the authenticated application**.
- GET /api/v1/templates — only templates visible to that application.
- GET/POST/PATCH/DELETE /api/v1/admin/applications/:appId/templates — dashboard
  RBAC only; DELETE archives by default; prevent deleting versions referenced
  by pending notifications.
- GET/POST/PATCH /api/v1/admin/applications/:appId/users — dashboard RBAC only,
  with paginated filters and bulk import; DELETE is audited deactivation or
  privacy deletion subject to retention requirements.
- PUT /api/v1/users/:externalUserId — app-key-authenticated upsert of a recipient
  belonging strictly to that application; no cross-app account lookup.
- GET/PATCH /api/v1/admin/applications/:appId/members — dashboard admin/owner
  only, Auth Service session required.
- POST /api/v1/webhooks/provider/:provider — verified provider signature.
- Internal /api/v1/admin/* — RBAC-protected human dashboard backend.
- GET /health — liveness; GET /ready — DB and Redis; GET /metrics — private
  or secured; avoid exposing sensitive operational telemetry publicly.

## Delivery semantics

- 202 means **accepted/queued**, never 'delivered'.
- Persist queued DB record + transactional outbox, enqueue outbox events
  idempotently to BullMQ, recover outbox after worker/API crashes.
- Retry temporary failures with exponential backoff + jitter.
- Permanent provider rejections, opt-outs and invalid template renderings are
  terminal. Keep a dead-letter review and audited manual redrive.
- Record a provider message ID, each attempt, and provider callbacks before
  marking final delivery status. 'Sent' means provider accepted, not recipient
  delivery; use delivered/bounced where the provider supplies those events.
- Avoid logging recipient addresses, full payloads, keys or SMTP secrets.
- Retain only necessary PII, support retention policies and deletion.

## Rollout stages

1. **Foundation (this PR):** app API keys from environment, scoped
   idempotency, Redis readiness, reject unsupported push API requests. This is a
   breaking integration change: set APP_API_KEYS and add X-API-Key on callers
   before merging/deploying. No production deployment is performed by this PR.
2. **Identity and multitenancy:** Prisma migration for Application and hashed
   credentials, credential rotation, per-app authorization, query scoping;
   integrate human dashboard with Auth Service and role checks.
3. **Dashboard v1:** app management, notification search/details, queues,
   error timeline, audited retries, health and metrics.
4. **Templates and users:** database-backed per-application versioned email
   templates with dashboard-only CRUD, preview/test/publish/archive workflows;
   application recipient directory, preferences and imports; dashboard team
   invites and per-app RBAC.
5. **Providers:** email sender configuration, real SMS integration, push
   integration and provider event callbacks.
6. **Reliability and integrations:** outbox, webhook subscriptions, batch API,
   quotas, per-app throttling, monitoring, runbooks and load testing.

## Acceptance / security checklist

- Requests without or with incorrect application key return 401.
- Application A cannot retrieve/mutate B's records or reuse B's idempotency
  record; test same raw idempotency key in A and B.
- Operator cannot administer applications without a verified Auth Service
  session and suitable role; all writes are audited.
- API key plaintext is revealed once, never stored in DB or logged.
- Redis down => /ready 503 and notification enqueues are not claimed successful.
- SMTP failure and retry exhaustion appear in dashboard with safe diagnostics.
- Template edits are versioned and cannot silently alter an already queued send.
- Creating/editing/archiving a template for App A never changes App B templates.
- An app administrator can add/remove its users, while an operator without
  appropriate application membership cannot see or change those users.
- App users are identified by application-scoped external IDs, never globally
  merged just because emails or phone numbers match.
- Template and user operations emit audit events; deletion respects privacy
  requirements and does not break historical delivery records.
- Every integration has a working sample request, documented status semantics
  and contract/integration tests.
