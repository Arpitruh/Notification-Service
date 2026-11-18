# Use Notification Service from any backend

**Important:** This service is intended for trusted server-to-server calls,
not direct requests from browsers. It is not a public anonymous email relay.

## Configure authorized consuming applications

Set `NOTIFICATION_CLIENTS_JSON` as a private environment variable **on the
Notification Service** (Render or another deployment):

```json
[
  {
    "id": "auth-service",
    "key": "GENERATE-A-UNIQUE-SECRET-AT-LEAST-32-CHARACTERS",
    "channels": ["email"],
    "templates": ["forgot-password", "welcome"]
  },
  {
    "id": "leadloop",
    "key": "ANOTHER-INDEPENDENT-SECRET-AT-LEAST-32-CHARACTERS",
    "channels": ["email"],
    "templates": ["welcome"]
  }
]
```

Configure each corresponding consumer backend with only **its own** key
(`NOTIFICATION_API_KEY`). Never put it in a browser bundle or
`NEXT_PUBLIC_` variable. IDs and keys must be unique. No configuration means
sending returns HTTP 503; invalid or missing credentials return HTTP 401.

## Send a notification

```bash
curl -X POST "$NOTIFICATION_URL/api/v1/notifications/send" \
  -H "Content-Type: application/json" \
  -H "x-notification-api-key: $NOTIFICATION_API_KEY" \
  -d '{
    "recipient":"user@example.com",
    "channel":"email",
    "templateId":"welcome",
    "payloadData":{"name":"User","dashboardUrl":"https://app.example.com"},
    "idempotencyKey":"signup-user-123"
  }'
```

The API returns `202 {notificationId,status:"queued"}`, not proof of email
delivery. Repeat the same key and identical intent for idempotent retries;
a different intent with the same key returns HTTP 409. Without a key, each
request is treated as a new notification. Keys are scoped automatically to
the authenticated calling application.

Use `GET /api/v1/notifications/{notificationId}` with the same API key to
poll safe status, such as queued/processing/sent/failed/dead_letter. Other
client IDs receive 404 for that ID.

## Next.js server action / route handler

```ts
export async function queueWelcome(email: string, userId: string) {
  const base = process.env.NOTIFICATION_SERVICE_URL;
  const key = process.env.NOTIFICATION_API_KEY;
  if (!base || !key) throw new Error('Notification service is not configured');
  const response = await fetch(`${base}/api/v1/notifications/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-notification-api-key': key },
    body: JSON.stringify({
      recipient: email, channel: 'email', templateId: 'welcome',
      payloadData: { name: 'User', dashboardUrl: 'https://app.example.com' },
      idempotencyKey: `welcome:${userId}`,
    }),
    cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Notification API failed (${response.status})`);
  return response.json();
}
```

## Security and operational boundaries

- Sending is **disabled by default** until `NOTIFICATION_CLIENTS_JSON` is set.
- CORS is not enabled for browser clients. Never ship an API key in JavaScript
  sent to users; server-to-server HTTPS requests do not need browser CORS.
- Per-client channel and optional template allowlists are enforced. App roles,
  tenant ownership and permission to send emails still belong to each app.
- SMS uses **Twilio in production** when the three `TWILIO_*` credentials
  are configured. The `sms-code` template supports `code` and
  `expiresInMinutes` and requires an E.164 phone number. Without Twilio,
  production refuses SMS. Development's mocked SMS is **not real delivery**.
  Push is unsupported and rejected.
- `/metrics` requires an independent `METRICS_API_KEY` (32+ characters);
  when unset, the endpoint returns 404.
- `/ready` checks both PostgreSQL and Redis without leaking connection errors.
- The service uses Postgres + BullMQ/Redis. The current enqueue flow is not
  a transactional outbox; review crash recovery, provider delivery semantics
  and rate limits before very high-volume, business-critical use.
- This PR deliberately does **not** deploy, send any real notifications,
  change the database schema, or provision provider accounts.
