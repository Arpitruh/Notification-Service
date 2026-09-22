import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  templateRenderer,
  TemplateNotFoundError,
  TemplateInvalidError,
  MissingTemplateVariablesError,
} from '../../services/template-renderer.js';

const schema = z.object({
  recipient: z.string().min(1),
  channel: z.enum(['email', 'sms', 'push']),
  templateId: z.string().min(1),
  payloadData: z.record(z.string(), z.any()),
  idempotencyKey: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  scheduledFor: z.iso.datetime().optional(),
});

export type SendNotificationInput = z.infer<typeof schema>;

export const validateSendNotification = (req: Request, res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: z.treeifyError(result.error) });
    return;
  }
  req.body = result.data;
  next();
};

/**
 * Strict template validation. Runs after `validateSendNotification`, so the body
 * is already parsed. For template-driven channels (email), it rejects the request
 * up front with HTTP 400 when the `templateId` is unknown or a required variable
 * is missing, before any job is enqueued.
 */
export const validateTemplate = (req: Request, res: Response, next: NextFunction): void => {
  const { channel, templateId, payloadData } = req.body as SendNotificationInput;

  // Only email is template-rendered today. Other channels pass through untouched.
  if (channel !== 'email') {
    next();
    return;
  }

  try {
    templateRenderer.assertExists(templateId);
    templateRenderer.validateVariables(templateId, payloadData);
    next();
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      res.status(400).json({ error: 'Unknown templateId', templateId: err.templateId });
      return;
    }
    if (err instanceof MissingTemplateVariablesError) {
      res.status(400).json({
        error: 'Missing template variables',
        templateId: err.templateId,
        missing: err.missing,
      });
      return;
    }
    if (err instanceof TemplateInvalidError) {
      res.status(400).json({
        error: 'Invalid template',
        templateId: err.templateId,
        reason: err.reason,
      });
      return;
    }
    next(err);
  }
};
