# Notification Service

A reusable, **backend-authenticated** notification microservice with an HTTP API and a BullMQ background worker.
Sends templated SMTP email and Twilio SMS (if configured), backed by
Postgres (audit + idempotency) and Redis (job queue).

**Integration and security:** Every sending backend needs its own 32+ character API key configured through `NOTIFICATION_CLIENTS_JSON`. Sending is disabled until clients are configured; do not expose API keys in frontend JavaScript. See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for usage and Next.js examples.

## Reuse across your applications

Each backend authenticates using an independent `x-notification-api-key`. The
service uses PostgreSQL audit records, Redis-based per-client minute/day quotas,
caller-scoped idempotency, and status polling. No browser API keys are allowed.
See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for integration examples.

**Important:** Before deploying this breaking auth change, configure
`NOTIFICATION_CLIENTS_JSON` on Render; without it all send requests return
503. A real SMTP sender and Twilio credentials are required for production
email/SMS delivery. Never commit those credentials.

## Architecture

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

Send a test email (server-only API key required):

```bash
curl -X POST http://localhost:4000/api/v1/notifications/send \
  -H "Content-Type: application/json" \
  -H "x-notification-api-key: $NOTIFICATION_API_KEY" \
  -H "x-notification-api-key: $NOTIFICATION_API_KEY" \\
  -d '{"recipient":"you@example.com","channel":"email","templateId":"welcome","payloadData":{"name":"Arpit","dashboardUrl":"https://app.example.com"}}'
```

Set `NOTIFICATION_CLIENTS_JSON` in the Notification Service environment, and put only your consumer key in `NOTIFICATION_API_KEY` locally. `GET /api/v1/notifications/:id` returns status for the authenticated caller. An explicit `idempotencyKey` is required for safe retries; without one, each request is intentional.

**SMS:** The current provider is mock-only. Production SMS requests are blocked rather than falsely marked as delivered. `push` is unsupported.

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
   - `NOTIFICATION_CLIENTS_JSON` — required authorized backend clients
   - optional `METRICS_API_KEY` — metrics protection
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (real SMS integration remains future work)
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

### Delivery recovery and quotas

The queue uses one deterministic BullMQ job ID per notification, preventing
duplicate queued jobs for the same audit record. A background reconciliation
sweep can re-enqueue orphaned **queued** records after a crash, but deliberately
does not retry ambiguous **processing** records (the provider may have delivered).
For delivery guarantees under very high concurrency, implement transactional
outbox and provider-specific delivery receipts.

Set `CLIENT_RATE_LIMIT_PER_MINUTE` and `CLIENT_DAILY_QUOTA` for a shared
Redis-backed limit per registered calling service. A failed Redis connection
returns 503 and does not bypass quota enforcement. The API exposes safe
GET /api/v1/notifications/:id status for the owning client only.

SMS: configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_PHONE_NUMBER` for real delivery. Example `sms-code` template needs
`code` and `expiresInMinutes`, with an E.164 recipient such as
`+15551234567`. Without credentials the development mock is not real delivery;
production refuses SMS requests.
