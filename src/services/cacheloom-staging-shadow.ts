/**
 * Best-effort staging mirror. BullMQ and the notification outbox remain the
 * authoritative delivery path; failures here must never delay a real email.
 */
export type ShadowOutboxEvent = {
  outboxId: string;
  notificationId: string;
  scheduledFor?: Date | string | null;
  priority?: number;
};

export type ShadowConfig = {
  enabled: boolean;
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export function readShadowConfig(env: NodeJS.ProcessEnv = process.env): ShadowConfig {
  const enabled = env.CACHELOOM_STAGING_SHADOW === 'true';
  if (!enabled) return { enabled: false };
  // Even an accidental Render env var cannot activate a second queue in prod.
  if (env.NODE_ENV === 'production') throw new Error('CacheLoom shadow is forbidden in production');
  const url = env.CACHELOOM_STAGING_URL;
  const apiKey = env.CACHELOOM_STAGING_KEY;
  if (!url || !apiKey || apiKey.length < 32) throw new Error('Missing staging CacheLoom endpoint or key');
  const parsed = new URL(url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    throw new Error('Staging CacheLoom requires HTTPS except on localhost');
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('Staging URL must not contain credentials or query strings');
  return { enabled: true, url, apiKey, timeoutMs: 4000 };
}

export function mapShadowEvent(event: ShadowOutboxEvent, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(event.outboxId) ||
      !/^[a-zA-Z0-9_-]{1,150}$/.test(event.notificationId))
    throw new Error('Invalid staging event identifiers');
  const when = event.scheduledFor ? new Date(event.scheduledFor).getTime() : now;
  if (!Number.isFinite(when)) throw new Error('Invalid staging schedule');
  const delaySeconds = Math.max(0, Math.ceil((when - now) / 1000));
  if (delaySeconds > 2592000) throw new Error('Staging schedule exceeds 30 days');
  const priority = event.priority ?? 0;
  if (!Number.isSafeInteger(priority) || priority < -10000 || priority > 10000)
    throw new Error('Invalid staging priority');
  return {
    command: 'ENQUEUE',
    queue: 'notifications-standard-staging',
    payload: { notificationId: event.notificationId, outboxId: event.outboxId },
    idempotencyKey: event.outboxId,
    maxAttempts: 3,
    priority,
    delaySeconds,
  };
}

export async function mirrorOutboxToCacheloom(
  event: ShadowOutboxEvent,
  config: ShadowConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ mirrored: boolean; duplicate?: boolean }> {
  if (!config.enabled) return { mirrored: false };
  if (!config.url || !config.apiKey) throw new Error('Invalid staging configuration');
  const endpoint = new URL('/v1/jobs', config.url);
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(mapShadowEvent(event)),
    signal: AbortSignal.timeout(config.timeoutMs ?? 4000),
  });
  if (!response.ok) throw new Error(`Staging mirror rejected request (${response.status})`);
  const result = await response.json() as { result?: { duplicate?: boolean } };
  return { mirrored: true, duplicate: Boolean(result.result?.duplicate) };
}
