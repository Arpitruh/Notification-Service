import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
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

const registrationEvent = z.object({
  userId: z.string().min(1).max(200),
  email: z.email(),
  name: z.string().max(120).optional(),
});
/** Caller sends only the registration event. Dashboard owns the template and URL. */
router.post('/events/user.registered', sendLimiter, authenticateApplication, async (req, res, next) => {
  try {
    const parsed = registrationEvent.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid registration event' }); return; }
    const app = await prisma.application.findUnique({ where: { slug: res.locals.applicationName as string } });
    if (!app?.enabled) { res.status(403).json({ error: 'Application not configured or disabled' }); return; }
    if (!app.welcome_enabled) { res.status(200).json({ status: 'disabled', message: 'Welcome emails disabled for application' }); return; }
    if (!app.dashboard_url) { res.status(409).json({ error: 'Application dashboard URL is not configured' }); return; }
    const { userId, email, name } = parsed.data;
    req.body = {
      recipient: email,
      channel: 'email',
      templateId: app.welcome_template,
      payloadData: { name: name?.trim() || 'there', appName: app.name, dashboardUrl: app.dashboard_url },
      idempotencyKey: 'registration-welcome:' + userId,
    };
    validateSendNotification(req, res, () => void validateTemplate(req, res, () => void sendNotification(req, res).catch(next)));
  } catch (err) { next(err); }
});

export const notificationRoutes = router;
