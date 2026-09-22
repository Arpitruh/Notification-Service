import { Worker } from 'bullmq';
interface NotificationJobData {
    notificationId: string;
    recipient: string;
    channel: 'email' | 'sms' | 'push';
    templateId: string;
    payloadData: Record<string, unknown>;
}
export declare function startNotificationWorker(): Worker<NotificationJobData>;
export {};
//# sourceMappingURL=notification.worker.d.ts.map