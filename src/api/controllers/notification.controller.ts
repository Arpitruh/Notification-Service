import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { SendNotificationInput } from '../middleware/validate.middleware.js';

const hash = (input: string) => crypto.createHash('sha256').update(input).digest('hex');

/** Canonical JSON prevents spurious conflicts for reordered payload keys. */
export function canonicalJson(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'null';
  if (Array.isArray(input)) return '[' + input.map(canonicalJson).join(',') + ']';
  const data = input as Record<string, unknown>;
  return '{' + Object.keys(data).sort().filter(key => data[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonicalJson(data[key])).join(',') + '}';
}

type Outcome =
  | { kind: 'created'; id: string }
  | { kind: 'duplicate'; id: string; status: string }
  | { kind: 'conflict' };

/** Each accepted notification and its outbox event commit together. */
async function accept(
  scopedKey: string,
  bodyHash: string,
  fields: Prisma.NotificationUncheckedCreateInput,
): Promise<Outcome> {
  try {
    return await prisma.$transaction(async tx => {
      const n = await tx.notification.create({
        data: { ...fields, idempotency_key: scopedKey, payload_hash: bodyHash, status: 'pending' },
        select: { id: true },
      });
      await tx.notificationOutbox.create({ data: { notification_id: n.id } });
      return { kind: 'created', id: n.id } as const;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }
  // A unique constraint is the synchronization point; no preflight SELECT race.
  const old = await prisma.notification.findUnique({ where: { idempotency_key: scopedKey } });
  if (!old) throw new Error('Concurrent idempotency transaction not visible');
  if (old.payload_hash && old.payload_hash !== bodyHash) return { kind: 'conflict' };
  // Never automatically replay a dead-letter/failed record on an ordinary API retry.
  // A dedicated audited replay operation will handle intentional manual replay.
  return { kind: 'duplicate', id: old.id, status: old.status };
}

export async function sendNotification(req: Request, res: Response): Promise<void> {
  const body = req.body as SendNotificationInput & { expiresAt?: string };
  const callerService = res.locals.applicationName as string;
  const applicationId = (res.locals.applicationId as string | undefined) ?? null;
  const renderedEmail = res.locals.renderedEmail as { subject: string; html: string } | undefined;

  const naturalKey = body.idempotencyKey || hash(canonicalJson({
    recipient: body.recipient, channel: body.channel,
    templateId: body.templateId, payloadData: body.payloadData,
  }));
  // Auth middleware supplies the immutable unique application slug.
  const scopedKey = hash(callerService + ':' + naturalKey);
  const bodyHash = res.locals.idempotencyMode === 'event'
    ? hash('event:' + naturalKey)
    : hash(canonicalJson({
        recipient: body.recipient, channel: body.channel,
        templateId: body.templateId, payloadData: body.payloadData,
      }));
  const outcome = await accept(scopedKey, bodyHash, {
    idempotency_key: scopedKey,
    recipient: body.recipient,
    channel: body.channel,
    template_id: body.templateId,
    payload_data: body.payloadData as Prisma.InputJsonValue,
    rendered_email: renderedEmail ? renderedEmail : Prisma.DbNull,
    priority: body.priority ?? 0,
    scheduled_for: body.scheduledFor ? new Date(body.scheduledFor) : null,
    expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
    caller_service: callerService,
    application_id: applicationId,
  });

  if (outcome.kind === 'conflict') {
    res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Key already used for a different delivery payload' });
    return;
  }
  if (outcome.kind === 'duplicate') {
    res.status(200).json({ notificationId: outcome.id, status: outcome.status,
      message: 'Idempotent match: Request already handled' });
    return;
  }
  // Compatibility: queued means durably accepted, not yet necessarily in Redis.
  res.status(202).json({
    notificationId: outcome.id, status: 'queued',
    message: 'Notification accepted for delivery',
  });
}
