import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';
import { templateRenderer } from '../services/template-renderer.js';
import { classifySmtpError } from '../services/smtp-error.js';

export interface CompiledNotification {
  recipient: string;
  templateId: string;
  payloadData: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  errorCode?: string;
  smtpResponseCode?: number;
  smtpCommand?: string;
  retryable?: boolean;
  ambiguous?: boolean;
}
export interface SendOptions { idempotencyId?: string; }
export type DeliveryFailure = Omit<DeliveryResult, 'success' | 'providerMessageId'>;

export class EmailProvider {
  channel = 'email' as const;
  private transporter = nodemailer.createTransport({
    host: ENV.SMTP.host,
    port: ENV.SMTP.port,
    secure: ENV.SMTP.secure,
    auth: ENV.SMTP.user ? { user: ENV.SMTP.user, pass: ENV.SMTP.pass } : undefined,
    dnsTimeout: 10_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  private messageId(id?: string): string | undefined {
    if (!id) return undefined;
    // ID must not allow RFC 5322 header injection.
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid notification identifier');
    const domain = /@([^>\s]+)/.exec(String(ENV.SMTP.from))?.[1] ?? 'localhost';
    return '<' + id + '@' + domain + '>';
  }

  /**
   * HTTPS transport for free Render instances, where standard SMTP ports are
   * blocked. Resend accepts idempotency keys so worker retries don't duplicate
   * provider-accepted messages. Its HTTP 2xx is acceptance, not inbox delivery.
   */
  private async deliverViaResend(recipient: string, subject: string, html: string, opts?: SendOptions): Promise<DeliveryResult> {
    const from = process.env.RESEND_FROM?.trim();
    if (!from) return { success: false, error: 'RESEND_FROM is not configured', errorCode: 'EMAIL_CONFIG', retryable: false };
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          ...(opts?.idempotencyId ? { 'Idempotency-Key': `notification-${opts.idempotencyId}` } : {}),
        },
        body: JSON.stringify({ from, to: [recipient], subject, html }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        return {
          success: false,
          error: 'Email provider rejected the request',
          errorCode: `EMAIL_HTTP_${response.status}`,
          retryable: response.status === 429 || response.status >= 500,
          ambiguous: false,
        };
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string') {
        return { success: false, error: 'Unexpected email provider response', errorCode: 'EMAIL_PROVIDER_RESPONSE', retryable: false, ambiguous: true };
      }
      return { success: true, providerMessageId: data.id };
    } catch {
      // The remote API may have accepted a request before network failure.
      // The provider-side idempotency key makes a subsequent retry safer.
      return { success: false, error: 'Email provider connection failed', errorCode: 'EMAIL_PROVIDER_NETWORK', retryable: !!opts?.idempotencyId, ambiguous: !opts?.idempotencyId };
    }
  }

  /** Gmail uses HTTPS (port 443), not SMTP, on Render Free.
   * Use only gmail.send scope and a dedicated sender Gmail account.
   * Never log OAuth tokens or the raw email (which can contain verification links).
   */
  private async deliverViaGmail(recipient: string, subject: string, html: string, opts?: SendOptions): Promise<DeliveryResult> {
    const clientId = process.env.GMAIL_CLIENT_ID?.trim();
    const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
    const from = process.env.GMAIL_FROM?.trim();
    if (!clientId || !clientSecret || !refreshToken || !from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) {
      return { success: false, error: 'Gmail OAuth credentials or sender not configured', errorCode: 'EMAIL_CONFIG', retryable: false };
    }
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!tokenResponse.ok) {
        return {
          success: false, error: 'Gmail OAuth token refresh failed',
          errorCode: `GMAIL_OAUTH_${tokenResponse.status}`,
          retryable: tokenResponse.status === 429 || tokenResponse.status >= 500,
          ambiguous: false,
        };
      }
      const token: unknown = await tokenResponse.json();
      if (!token || typeof token !== 'object' || !('access_token' in token) ||
          typeof token.access_token !== 'string' || !token.access_token) {
        return { success: false, error: 'Gmail OAuth response missing access token', errorCode: 'GMAIL_OAUTH_RESPONSE', retryable: false };
      }

      // Let Nodemailer build a standards-compliant MIME message, including
      // subject encoding and safe header folding for non-ASCII recipients.
      const mimeTransport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      const composed = await mimeTransport.sendMail({
        from: `Projects <${from}>`, to: recipient, subject, html,
        ...(opts?.idempotencyId ? { messageId: `<${opts.idempotencyId}@projects.gmail.local>` } : {}),
      });
      const raw = composed.message;
      if (!Buffer.isBuffer(raw)) return { success: false, error: 'Could not compose email', errorCode: 'GMAIL_MIME', retryable: false };
      const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: raw.toString('base64url') }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!gmailResponse.ok) {
        return {
          success: false, error: 'Gmail API rejected the message',
          errorCode: `GMAIL_HTTP_${gmailResponse.status}`,
          retryable: gmailResponse.status === 429 || gmailResponse.status >= 500,
          ambiguous: false,
        };
      }
      const result: unknown = await gmailResponse.json();
      if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
        // API may have accepted the message. Don't retry without provider idempotency.
        return { success: false, error: 'Gmail API did not return a message ID', errorCode: 'GMAIL_RESPONSE', retryable: false, ambiguous: true };
      }
      return { success: true, providerMessageId: result.id };
    } catch {
      // Gmail API has no send idempotency key; an interrupted request may
      // have been accepted. Protect recipients from accidental duplicate sends.
      return { success: false, error: 'Gmail email request outcome is uncertain', errorCode: 'GMAIL_NETWORK', retryable: false, ambiguous: true };
    }
  }

  private async deliver(recipient: string, subject: string, html: string, opts?: SendOptions): Promise<DeliveryResult> {
    // Explicit provider choice takes precedence. Never silently fall back to
    // another sender after a Gmail authorization or delivery failure.
    if (process.env.EMAIL_PROVIDER?.trim() === 'gmail') {
      return this.deliverViaGmail(recipient, subject, html, opts);
    }
    if (process.env.RESEND_API_KEY?.trim()) {
      return this.deliverViaResend(recipient, subject, html, opts);
    }
    try {
      const info = await this.transporter.sendMail({
        from: ENV.SMTP.from, to: recipient, subject, html,
        messageId: this.messageId(opts?.idempotencyId),
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (err) {
      return { success: false, ...classifySmtpError(err) };
    }
  }

  async sendRendered(recipient: string, content: { subject: string; html: string }, opts?: SendOptions): Promise<DeliveryResult> {
    return this.deliver(recipient, content.subject, content.html, opts);
  }

  async send(payload: CompiledNotification, opts?: SendOptions): Promise<DeliveryResult> {
    // TemplateError intentionally propagates to the worker as non-retryable.
    const { subject, html } = templateRenderer.render(payload.templateId, payload.payloadData);
    return this.deliver(payload.recipient, subject, html, opts);
  }
}
