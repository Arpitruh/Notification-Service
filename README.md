# Notification Service

A notification microservice with an HTTP API and a BullMQ background worker.
Sends templated emails (file-based Handlebars templates) and mock SMS, backed by
Postgres (audit + idempotency) and Redis (job queue).

## Notification Dashboard (feature branch)\n\nOpen \`/dashboard\` (root redirects there) to use the standalone web panel.\nThe dashboard uses **Auth Service login and token introspection**.\nConfigure \`AUTH_SERVICE_URL\`, \`AUTH_SERVICE_KEY\`,\n\`DASHBOARD_ADMIN_SUBJECTS\` and \`APP_API_KEYS\` before deployment.\nTemplate and recipient management is scoped per application with dashboard\nroles (owner/admin/editor/viewer), audited writes, and archived templates.\nAn application must be created in the dashboard with a slug matching its\n\`APP_API_KEYS\` application name for database-managed templates to send.\n\nPublished dashboard templates are rendered and snapshotted at enqueue time;\nexisting file-based templates remain available only for app keys without a\nregistered dashboard application during migration. **This feature is not fully\nproduction hardened**: API keys are still environment-managed, recipient imports,\ntemplate version history, opt-outs, real SMS, push, and dashboard pagination\nare not implemented. Template archives are reversible; application-user\n\`DELETE\` deactivates rather than physically deleting records.\n\n## Architecture

- **API** (`src/server.ts`) — Express app exposing `POST /api/v1/notifications/send`,
  plus `/health`, `/ready`, and `/metrics`.
- **Worker** (`src/workers/notification.worker.ts`) — processes queued jobs and
  dispatches through the email/SMS providers. Runs in the same process as the API.
- **Templates** (`src/templates/`) — Handlebars `.hbs` bodies + `.json` metadata,
  rendered by `TemplateRenderer` with strict variable validation.
- **Postgres** (Neon) — notification audit records and idempotency.
- **Redis** (Render Key Value in prod) — BullMQ queue.

## Local development

Requires Node 20.19+ or 22.12+ (Prisma 7), a reachable Postgres, and Redis.

```bash
cp .env.example .env      # then fill in real values
npm install
npx prisma migrate deploy # apply migrations to your database
npm run dev               # starts API + worker with hot reload
```

Send a test email:

```bash
curl -X POST http://localhost:4000/api/v1/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"recipient":"you@example.com","channel":"email","templateId":"welcome","payloadData":{"name":"Arpit","dashboardUrl":"https://app.example.com"}}'
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run API + worker with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript and copy templates to `dist/` |
| `npm start` | Run the compiled server (`node dist/server.js`) |
| `npm test` | Run the unit test suite once (`vitest run`) |

## Deployment (Render)

The repo ships a Render Blueprint (`render.yaml`) and a `Dockerfile`. The
blueprint provisions:

- a Docker **web service** (`notification-service`) running the API + worker, and
- a managed **Key Value** instance (`notification-redis`) for the BullMQ queue.

Postgres is external (Neon), so `DATABASE_URL` is provided as a Render secret.

### Steps

1. Push this repo to GitHub/GitLab.
2. In Render, create a new **Blueprint** and point it at the repo. Render reads
   `render.yaml` and creates the web service and Key Value instance.
3. Set the secret env vars (marked `sync: false` in `render.yaml`) in the Render
   dashboard for the web service:
   - `DATABASE_URL` — Neon pooled connection string
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
   `REDIS_HOST` and `REDIS_PORT` are wired automatically from the Key Value
   instance.
4. Deploy. On each release the container entrypoint runs
   `prisma migrate deploy` before starting the server, so schema changes are
   applied automatically.
5. Verify with the health check: `GET https://<your-service>.onrender.com/health`
   should return `{ "status": "UP" }`, and `/ready` confirms the DB connection.

### Notes

- The Docker image pins Node 22 (Prisma 7 requirement) and runs as a non-root user.
- The Key Value instance uses `maxmemoryPolicy: noeviction`, which BullMQ requires
  so queued jobs are never evicted.
- Never commit real secrets. `.env` is gitignored; use `.env.example` as the
  template and set real values as Render secrets.
- Building the image locally (optional): `docker build -t notification-service .`

## Templates

Add a template by creating a pair of files in `src/templates/`:

- `<id>.hbs` — the HTML body (Handlebars).
- `<id>.json` — `{ "subject": "...", "requiredVariables": ["..."] }`.

Requests with an unknown `templateId` or missing required variables are rejected
with HTTP 400 before any job is enqueued.

## Optional CacheLoom v0.9 staging shadow (feature branch)

The outbox relay can copy **metadata-only** notifications to a separate
CacheLoom staging queue *after* successful BullMQ enqueue and PostgreSQL
outbox commit. This is a best-effort comparison path, not an alternative
delivery engine. It never changes the BullMQ worker, delivery policy, or
`reconcileQueuedJobs()`; it cannot send emails or SMS.

This feature is disabled unless all staging variables are set in a
**non-production** environment:

```bash
NODE_ENV=test
CACHELOOM_STAGING_SHADOW=true
CACHELOOM_STAGING_URL=http://127.0.0.1:8080
CACHELOOM_STAGING_KEY=<random-key-at-least-32-characters>
```

Remote CacheLoom instances must use HTTPS. Production mode rejects shadow
activation even if someone accidentally sets the flag. The mirror uses
`notifications-standard-staging`, stores only the notification and outbox
IDs, and retains the deterministic outbox ID as its idempotency key.
Recipients and rendered templates are **not** copied.

**Testing:** GitHub Actions runs a mocked CacheLoom transport through the
real Redis/PostgreSQL outbox relay, then exercises existing Redis recovery.
The simulated CacheLoom worker tests live in CacheLoom v0.8. No deployed
CacheLoom endpoint or paid provider is required in CI.

**Important:** This branch is not a full BullMQ replacement. Its mock
transport only proves enqueue shape and failure isolation; a true deployment
needs a separate non-production CacheLoom server, comparison metrics and
notification outcome/lease-fencing tests. Keep the feature disabled in any
production Render service.
