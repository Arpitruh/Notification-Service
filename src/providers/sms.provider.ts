import type { CompiledNotification, DeliveryResult } from './email.provider.js';

export class SmsProvider {
  channel = 'sms' as const;

  async send(payload: CompiledNotification): Promise<DeliveryResult> {
    // A mock is not real delivery: never report a fake successful SMS in production.
    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'SMS provider is not configured for real delivery' };
    }
    try {
      console.log('\n----------------------------------------');
      console.log('📱 [FREE MOCK SMS GATEWAY] Outbound Text Message:');
      console.log(`To: ${payload.recipient}`);
      console.log(`Template ID: ${payload.templateId}`);
      console.log(`Payload Data: ${JSON.stringify(payload.payloadData, null, 2)}`);
      console.log('----------------------------------------\n');

      // Return a simulated provider message ID for the audit log
      return { success: true, providerMessageId: `mock-sms-${Date.now()}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}