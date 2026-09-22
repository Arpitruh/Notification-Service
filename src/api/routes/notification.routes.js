import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendNotification } from '../controllers/notification.controller.js';
import { validateSendNotification } from '../middleware/validate.middleware.js';
const sendLimiter = rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please retry later.' },
});
const router = Router();
router.post('/send', sendLimiter, validateSendNotification, sendNotification);
export const notificationRoutes = router;
//# sourceMappingURL=notification.routes.js.map