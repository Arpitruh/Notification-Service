import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const clientSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,59}$/, 'Invalid service client ID'),
  key: z.string().min(32, 'Client API key must contain at least 32 characters'),
  channels: z.array(z.enum(['email', 'sms'])).min(1),
  templates: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).optional(),
});
export type NotificationClient = z.infer<typeof clientSchema>;

/** The deployment environment is the source of truth for consumers. */
export function parseNotificationClients(raw: string | undefined): NotificationClient[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('NOTIFICATION_CLIENTS_JSON must be valid JSON'); }
  const clients = z.array(clientSchema).min(1).parse(parsed);
  if (new Set(clients.map((c) => c.id)).size !== clients.length ||
      new Set(clients.map((c) => c.key)).size !== clients.length) {
    throw new Error('Notification client IDs and API keys must be unique.');
  }
  return clients;
}

/** Compare equal-size digests instead of variable-length API keys. */
export function safeKeyEquals(candidate: unknown, secret: string): boolean {
  if (typeof candidate !== 'string' || candidate.length > 1024) return false;
  return timingSafeEqual(
    createHash('sha256').update(candidate).digest(),
    createHash('sha256').update(secret).digest(),
  );
}
export function resolveNotificationClient(
  candidate: unknown, clients: readonly NotificationClient[],
): NotificationClient | null {
  let matched: NotificationClient | null = null;
  for (const client of clients) {
    if (safeKeyEquals(candidate, client.key)) matched = client;
  }
  return matched;
}
