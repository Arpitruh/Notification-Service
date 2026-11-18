import twilio from 'twilio';
import { ENV } from '../config/env.js';
import { templateRenderer } from '../services/template-renderer.js';
import type { CompiledNotification, DeliveryResult } from './email.provider.js';

export class SmsProvider {
  channel = 'sms' as const;
  private readonly client = ENV.TWILIO.accountSid && ENV.TWILIO.authToken
    ? twilio(ENV.TWILIO.accountSid, ENV.TWILIO.authToken)
    : null;

  async send(payload: CompiledNotification): Promise<DeliveryResult> {
    const body = templateRenderer.render(payload.templateId, payload.payloadData).html;
    if (!/^\+[1-9]\d{7,14}$/.test(payload.recipient)) {
      return { success: false, error: 'Invalid E.164 SMS recipient.' };
    }
    if (body.length > 1600) return { success: false, error: 'SMS template is too long.' };
    if (!this.client || !ENV.TWILIO.phoneNumber) {
      // Development mock is explicit; a production call never claims delivery.
      if (process.env.NODE_ENV === 'production') {
        return { success: false, error: 'SMS delivery is not configured.' };
      }
      return { success: true, providerMessageId: 'mock-sms-' + Date.now() };
    }
    try {
      const message = await this.client.messages.create({
        to: payload.recipient,
        from: ENV.TWILIO.phoneNumber,
        body,
      });
      return { success: true, providerMessageId: message.sid };
    } catch {
      // Provider errors should not contain phone numbers or credentials in audit logs.
      return { success: false, error: 'SMS provider rejected delivery.' };
    }
  }
}
