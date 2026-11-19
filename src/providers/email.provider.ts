import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';
import { templateRenderer } from '../services/template-renderer.js';

export interface CompiledNotification {
  recipient: string;
  templateId: string;
  payloadData: Record<string, any>;
}

export interface DeliveryResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export class EmailProvider {
  channel = 'email' as const;
  private transporter = nodemailer.createTransport({
    host: ENV.SMTP.host,
    port: ENV.SMTP.port,
    secure: ENV.SMTP.secure,
    auth: ENV.SMTP.user ? { user: ENV.SMTP.user, pass: ENV.SMTP.pass } : undefined,
  });

  async sendRendered(recipient: string, content: { subject: string; html: string }): Promise<DeliveryResult> {
    try {
      const info = await this.transporter.sendMail({ from: ENV.SMTP.from, to: recipient,
        subject: content.subject, html: content.html });
      return { success: true, providerMessageId: info.messageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Email delivery failed' };
    }
  }

  async send(payload: CompiledNotification): Promise<DeliveryResult> {
    // Render outside the try/catch: a TemplateError must propagate so the worker
    // can treat it as unrecoverable rather than a transient delivery failure.
    const { subject, html } = templateRenderer.render(payload.templateId, payload.payloadData);

    try {
      const info = await this.transporter.sendMail({
        from: ENV.SMTP.from,
        to: payload.recipient,
        subject,
        html,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}