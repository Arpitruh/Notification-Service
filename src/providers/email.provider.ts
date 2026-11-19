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
