import type { CompiledNotification, DeliveryResult } from './email.provider.js';
export declare class SmsProvider {
    channel: 'sms';
    send(payload: CompiledNotification): Promise<DeliveryResult>;
}
//# sourceMappingURL=sms.provider.d.ts.map