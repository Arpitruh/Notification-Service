import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  ENV: {
    SMTP: { host: 'localhost', port: 1025, secure: false, user: '', pass: '', from: 'test@example.com' },
  },
}));
import { EmailProvider } from '../src/providers/email.provider.js';

describe('free HTTPS email transport', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.stubEnv('RESEND_FROM', 'LeadLoop <verified@example.com>');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('sends over HTTPS with a stable idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: 'provider-message-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new EmailProvider().sendRendered('customer@example.com', {
      subject: 'Verify your email', html: '<p>Hello</p>',
    }, { idempotencyId: 'safe-id' });
    expect(result).toEqual({ success: true, providerMessageId: 'provider-message-1' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers['Idempotency-Key']).toBe('notification-safe-id');
    expect(JSON.parse(options.body)).toMatchObject({ to: ['customer@example.com'], from: 'LeadLoop <verified@example.com>' });
  });
  it('retries HTTP 429 but not permanent HTTP 403', async () => {
    for (const status of [429, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      const result = await new EmailProvider().sendRendered('customer@example.com', { subject: 'Test', html: 'Test' }, { idempotencyId: 'stable-id' });
      expect(result).toMatchObject({ success: false, errorCode: `EMAIL_HTTP_${status}`, retryable: status === 429 });
    }
  });
  it('rejects missing verified sender before calling the provider', async () => {
    vi.stubEnv('RESEND_FROM', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new EmailProvider().sendRendered('customer@example.com', { subject: 'Test', html: 'Test' }))
      .toMatchObject({ success: false, errorCode: 'EMAIL_CONFIG', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
