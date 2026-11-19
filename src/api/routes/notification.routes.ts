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


// Backend-only delivery status; only the authenticated application's records
// are visible. Never return raw payload_data, rendered email or SMTP errors.
router.get('/:id', authenticateApplication, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const n = await prisma.notification.findFirst({
      where: { id, caller_service: res.locals.applicationName as string },
      select: { id: true, status: true, channel: true,
        created_at: true, updated_at: true, attempts: true },
    });
    if (!n) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.set('Cache-Control', 'no-store');
    res.json({ notification: n });
  } catch (error) { next(error); }
});

// Cancellation is an atomic transition. A worker already processing the item
// cannot be cancelled here; the queued job becomes a harmless no-op.
router.post('/:id/cancel', authenticateApplication, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const n = await prisma.notification.updateMany({
      where: { id, caller_service: res.locals.applicationName as string,
        status: { in: ['pending', 'queued'] } },
      data: { status: 'cancelled' },
    });
    if (!n.count) {
      res.status(409).json({ error: 'Notification is not cancellable or does not exist' });
      return;
    }
    res.json({ notificationId: id, status: 'cancelled' });
  } catch (error) { next(error); }
});

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
    // Preserve middleware errors; the old callback ignored next(err) and could
    // enqueue a notification after template validation had failed.
    res.locals.idempotencyMode = 'event';
    validateSendNotification(req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      void validateTemplate(req, res, (templateError?: unknown) => {
        if (templateError) { next(templateError); return; }
        void sendNotification(req, res).catch(next);
      });
    });
  } catch (err) { next(err); }
});

export const notificationRoutes = router;
