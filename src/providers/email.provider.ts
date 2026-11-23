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

  private async deliver(recipient: string, subject: string, html: string, opts?: SendOptions): Promise<DeliveryResult> {
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
