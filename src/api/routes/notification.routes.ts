import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendNotification, getNotificationStatus } from '../controllers/notification.controller.js';
import { requireNotificationClient, requireClientPermission } from '../middleware/client-auth.middleware.js';
import {
  validateSendNotification,
  validateTemplate,
} from '../middleware/validate.middleware.js';

const sendLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please retry later.' },
});

const router = Router();
router.use(requireNotificationClient);
router.post('/send', sendLimiter, validateSendNotification, requireClientPermission, validateTemplate, sendNotification);
router.get('/:id', getNotificationStatus);

export const notificationRoutes = router;
