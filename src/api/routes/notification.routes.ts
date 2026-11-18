import { Router } from 'express';
import { clientQuotaLimiter } from '../middleware/client-quota.middleware.js';
import { sendNotification, getNotificationStatus } from '../controllers/notification.controller.js';
import { requireNotificationClient, requireClientPermission } from '../middleware/client-auth.middleware.js';
import {
  validateSendNotification,
  validateTemplate,
} from '../middleware/validate.middleware.js';

const router = Router();
router.use(requireNotificationClient);
router.post('/send', validateSendNotification, requireClientPermission, validateTemplate, clientQuotaLimiter, sendNotification);
router.get('/:id', getNotificationStatus);

export const notificationRoutes = router;
