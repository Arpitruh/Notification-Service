import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
declare const schema: z.ZodObject<{
    recipient: z.ZodString;
    channel: z.ZodEnum<{
        email: "email";
        push: "push";
        sms: "sms";
    }>;
    templateId: z.ZodString;
    payloadData: z.ZodRecord<z.ZodString, z.ZodAny>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodNumber>;
    scheduledFor: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strip>;
export type SendNotificationInput = z.infer<typeof schema>;
export declare const validateSendNotification: (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=validate.middleware.d.ts.map