import { describe, expect, it } from 'vitest';
import { parseNotificationClients, resolveNotificationClient, safeKeyEquals } from './client-auth.js';

const first = 'first-notification-client-key-at-least-32-characters';
const second = 'second-notification-client-key-at-least-32-characters';
const raw = JSON.stringify([
  { id: 'leadloop', key: first, channels: ['email'], templates: ['welcome'] },
  { id: 'auth-service', key: second, channels: ['email'] },
]);

describe('notification backend client configuration', () => {
  it('resolves independent keys without trusting caller-supplied identities', () => {
    const clients = parseNotificationClients(raw);
    expect(resolveNotificationClient(first, clients)?.id).toBe('leadloop');
    expect(resolveNotificationClient(second, clients)?.id).toBe('auth-service');
    expect(resolveNotificationClient('invalid', clients)).toBe(null);
    expect(safeKeyEquals(first, first.slice(0, -1))).toBe(false);
  });
  it('rejects duplicate identities, weak keys, invalid JSON and unsupported channels', () => {
    expect(() => parseNotificationClients('invalid')).toThrow();
    expect(() => parseNotificationClients(JSON.stringify([{ id:'x', key:'short', channels:['email'] }]))).toThrow();
    expect(() => parseNotificationClients(JSON.stringify([{ id:'x-client', key:first, channels:['push'] }]))).toThrow();
    expect(() => parseNotificationClients(JSON.stringify([
      { id:'leadloop', key:first, channels:['email'] }, { id:'leadloop', key:second, channels:['email'] },
    ]))).toThrow();
  });
});
