import { createHash, randomUUID } from 'node:crypto';

/** Caller-scoped to prevent two different apps colliding on the same key. */
export function scopedIdempotencyKey(clientId: string, suppliedKey?: string): string {
  const key = suppliedKey ?? randomUUID();
  return createHash('sha256').update(clientId + '\0' + key).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(obj[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export interface NotificationIntent {
  recipient: string;
  channel: string;
  templateId: string;
  payloadData: unknown;
  priority: number;
  scheduledFor: Date | null;
}
export interface SavedNotificationIntent {
  recipient: string;
  channel: string;
  template_id: string;
  payload_data: unknown;
  priority: number;
  scheduled_for: Date | null;
}
export function sameNotificationIntent(saved: SavedNotificationIntent, incoming: NotificationIntent): boolean {
  return saved.recipient === incoming.recipient &&
    saved.channel === incoming.channel &&
    saved.template_id === incoming.templateId &&
    stableJson(saved.payload_data) === stableJson(incoming.payloadData) &&
    saved.priority === incoming.priority &&
    (saved.scheduled_for?.toISOString() ?? null) === (incoming.scheduledFor?.toISOString() ?? null);
}
