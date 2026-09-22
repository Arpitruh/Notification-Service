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
export declare class EmailProvider {
    channel: 'email';
    private transporter;
    send(payload: CompiledNotification): Promise<DeliveryResult>;
}
//# sourceMappingURL=email.provider.d.ts.map