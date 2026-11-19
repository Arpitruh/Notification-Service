import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateApplication } from '../middleware/authenticate-application.js';
import { sendNotification } from '../controllers/notification.controller.js';
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
router.post('/send', sendLimiter, authenticateApplication, validateSendNotification, validateTemplate, sendNotification);

export const notificationRoutes = router;
