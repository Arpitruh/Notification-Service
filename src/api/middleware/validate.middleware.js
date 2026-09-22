import { z } from 'zod';
const schema = z.object({
    recipient: z.string().min(1),
    channel: z.enum(['email', 'sms', 'push']),
    templateId: z.string().min(1),
    payloadData: z.record(z.string(), z.any()),
    idempotencyKey: z.string().min(1).optional(),
    priority: z.number().int().optional(),
    scheduledFor: z.iso.datetime().optional(),
});
export const validateSendNotification = (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Validation failed', details: z.treeifyError(result.error) });
        return;
    }
    req.body = result.data;
    next();
};
//# sourceMappingURL=validate.middleware.js.map