import { describe, expect, it } from 'vitest';
import { trustedLoginHeaders } from '../../src/api/routes/dashboard.routes.js';

describe('dashboard login trusted proxy headers', () => {
  it('sends the authenticated backend identity and upstream client address', () => {
    const result = trustedLoginHeaders('198.51.100.7', 'test-service-credential');
    expect(result).toEqual({
      'content-type': 'application/json',
      'x-auth-service-key': 'test-service-credential',
      'x-original-client-ip': '198.51.100.7',
    });
    expect(result).not.toHaveProperty('x-forwarded-for');
  });
  it('does not replace different client addresses with the Notification Service IP', () => {
    const first = trustedLoginHeaders('198.51.100.7', 'server-key');
    const second = trustedLoginHeaders('198.51.100.8', 'server-key');
    expect(first['x-original-client-ip']).not.toBe(second['x-original-client-ip']);
  });
});
