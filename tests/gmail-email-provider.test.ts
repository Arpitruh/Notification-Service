import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  ENV: { SMTP: { host: 'localhost', port: 1025, secure: false, user: '', pass: '', from: 'unused@example.com' } },
}));
import { EmailProvider } from '../src/providers/email.provider.js';

describe('Gmail API delivery', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_PROVIDER', 'gmail');
    vi.stubEnv('GMAIL_FROM', 'arpit.yadav.projects@gmail.com');
    vi.stubEnv('GMAIL_CLIENT_ID', 'google-client-id');
    vi.stubEnv('GMAIL_CLIENT_SECRET', 'google-client-secret');
    vi.stubEnv('GMAIL_REFRESH_TOKEN', 'google-refresh-token');
    vi.stubEnv('RESEND_API_KEY', 'resend-should-not-be-used');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('refreshes a scoped token and sends RFC-compliant MIME through Gmail HTTPS', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (requests.length === 1) return { ok: true, json: async () => ({ access_token: 'short-lived-token' }) };
      return { ok: true, json: async () => ({ id: 'gmail-accepted-123' }) };
    }));
    const result = await new EmailProvider().sendRendered('recruiter@example.com', {
      subject: 'Verify your email', html: '<p><a href="https://example.com/verify">Verify</a></p>',
    }, { idempotencyId: 'safe-message-id' });
    expect(result).toEqual({ success: true, providerMessageId: 'gmail-accepted-123' });
    expect(requests.map(r => r.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ]);
    expect(String(requests[0].init.body)).toContain('grant_type=refresh_token');
    expect((requests[1].init.headers as Record<string,string>).Authorization).toBe('Bearer short-lived-token');
    const raw = JSON.parse(String(requests[1].init.body)).raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('arpit.yadav.projects@gmail.com');
    expect(mime).toContain('recruiter@example.com');
    expect(mime).toContain('Verify your email');
    expect(mime).toContain('https://example.com/verify');
    expect(mime).not.toContain('google-refresh-token');
  });

  it('does not fall back to Resend when OAuth fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new EmailProvider().sendRendered('someone@example.com', { subject: 'Test', html: 'Test' });
    expect(result).toMatchObject({ success: false, errorCode: 'GMAIL_OAUTH_401', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed with incomplete Google credentials', async () => {
    vi.stubEnv('GMAIL_REFRESH_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await new EmailProvider().sendRendered('someone@example.com', { subject: 'Test', html: 'Test' });
    expect(result).toMatchObject({ success: false, errorCode: 'EMAIL_CONFIG' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks ambiguous Gmail send failures unknown instead of blindly retrying', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockRejectedValueOnce(new Error('network timeout')));
    const result = await new EmailProvider().sendRendered('someone@example.com', { subject: 'Test', html: 'Test' });
    expect(result).toMatchObject({ success: false, errorCode: 'GMAIL_NETWORK', ambiguous: true, retryable: false });
  });

  it('retries quota errors but not recipient permission failures', async () => {
    for (const status of [429, 403]) {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockResolvedValueOnce({ ok: false, status }));
      const result = await new EmailProvider().sendRendered('someone@example.com', { subject: 'Test', html: 'Test' });
      expect(result).toMatchObject({ success: false, errorCode: `GMAIL_HTTP_${status}`, retryable: status === 429 });
    }
  });
});
