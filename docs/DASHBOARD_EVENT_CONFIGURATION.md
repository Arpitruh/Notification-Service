# Dashboard-managed application notification settings

## Setup (no per-app template environment variables)

1. Sign in to `/dashboard`; select or register an application.
2. Create and publish that application's `welcome` email template, with
   `name`, `appName`, and `dashboardUrl` variables.
3. Open **App Settings**: specify the application's public HTTPS dashboard/login
   URL, choose the welcome template slug, then enable welcome email.
4. Open **API Keys**: generate a key with a descriptive label. Copy immediately;
   only a SHA-256 digest is stored. Rotate with overlapping keys and revoke old
   credentials after your calling backend has been switched.
5. On the calling **backend only**, set the Notification Service URL and the one-time
   API key. The application sends the event below after a successful registration.

```http
POST /api/v1/notifications/events/user.registered
X-API-Key: <backend-only-app-key>
Content-Type: application/json

{"userId":"immutable-user-id","email":"registered@example.com","name":"Optional display name"}
```

The API infers application identity **only** from the API key. It loads the
application's enabled flag, chosen published template and dashboard URL from the
database. It renders and snapshots the content before enqueuing. A repeated
`userId` is idempotent per application. HTTP 202 means queued; HTTP 200 means
already accepted or welcome disabled, not proof of inbox delivery.

### Security and migration

- Keep the `APP_API_KEYS` map during an incremental migration; keys from that map
  continue to authenticate, and can be removed after moving apps to dashboard
  generated credentials. Newly created credentials do **not** require editing
  Notification Service environment variables.
- Application-specific settings and credentials are restricted by Auth Service
  user membership and application roles; platform operators can manage all apps.
- Generated secrets are shown once and stored only as hashes. A revoked key can
  no longer authenticate. Never put keys in browsers, mobile apps, frontend
  environment variables or chat messages.
- Bootstrap Auth Service integration still needs one-time connection values
  (`NOTIFICATION_SERVICE_URL`, `NOTIFICATION_API_KEY`) in the Auth Service
  backend. Moving these trust-bootstrap secrets into only the Notification
  Dashboard would make it impossible for the Auth Service to authenticate itself.
- The Notification Service does not magically observe registrations made in
  unconnected applications. Integrate each registration backend or shared Auth
  Service with the event endpoint.
- No guarantee of eventual delivery yet: registration sends are currently
  best-effort and the enqueue path needs a transactional outbox for crash
  recovery. Queue acceptance does not mean delivered.
- Sender transport credentials (SMTP) remain server-managed shared secrets,
  not editable dashboard fields in this phase.
