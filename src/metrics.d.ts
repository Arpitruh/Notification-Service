import client from 'prom-client';
export declare const registry: client.Registry<"text/plain; version=0.0.4; charset=utf-8">;
export declare const notificationsProcessed: client.Counter<"channel" | "outcome">;
export declare const notificationDeliveryDuration: client.Histogram<"channel">;
export declare const notificationsEnqueued: client.Counter<"channel">;
//# sourceMappingURL=metrics.d.ts.map