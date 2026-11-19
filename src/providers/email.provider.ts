import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';
import { templateRenderer } from '../services/template-renderer.js';

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

const CONNECTION_ERRORS = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS', 'ETLS', 'EPROTOCOL']);
const PERMANENT_ERRORS = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE']);

/** Nodemailer error taxonomy; keep machine-readable metadata for the worker.
 * A failure during/after DATA can be ambiguous even when transport reports a
 * timeout: a remote SMTP server might have accepted the message already.
 */
export function classifySmtpError(err: unknown): DeliveryFailure {
  const e = (err ?? {}) as { message?: string; code?: string; responseCode?: number; command?: string };
  const base = {
    error: String(e.message || 'Email delivery failed'),
    ...(typeof e.responseCode === 'number' ? { smtpResponseCode: e.responseCode } : {}),
    ...(typeof e.command === 'string' ? { smtpCommand: e.command } : {}),
  };
  const afterData = typeof e.command === 'string' && /^DATA\b/i.test(e.command);
  if (e.code === 'EAUTH') return { ...base, errorCode: 'SMTP_AUTH', retryable: false, ambiguous: false };
  if (typeof e.responseCode === 'number') {
    if (e.responseCode >= 400 && e.responseCode <= 499)
      return { ...base, errorCode: 'SMTP_' + e.responseCode, retryable: true, ambiguous: false };
    if (e.responseCode >= 500 && e.responseCode <= 599)
      return { ...base, errorCode: 'SMTP_' + e.responseCode, retryable: false, ambiguous: false };
    return { ...base, errorCode: 'SMTP_UNEXPECTED_RESPONSE', retryable: false, ambiguous: false };
  }
  if (e.code && PERMANENT_ERRORS.has(e.code))
    return { ...base, errorCode: e.code, retryable: false, ambiguous: false };
  if (e.code && CONNECTION_ERRORS.has(e.code))
    return { ...base, errorCode: e.code, retryable: true, ambiguous: afterData };
  // Unknown failures should not be silently classified as permanent or safe to retry.
  return { ...base, errorCode: e.code || 'SMTP_UNKNOWN_ERROR', retryable: false, ambiguous: afterData };
}

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

  private async deliver(recipient: string, subject: string, html: string, opts?: SendOptions): Promise<DeliveryResult> {
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
