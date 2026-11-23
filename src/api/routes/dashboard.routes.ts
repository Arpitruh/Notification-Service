import { Router } from 'express';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireDashboardIdentity, isPlatformAdmin, type DashboardIdentity } from '../middleware/dashboard-auth.js';

export const dashboardRoutes = Router();

/** Backend-only identity assertion for proxied login attempts.
 * The target Auth Service verifies the key before honoring original client IP.
 */
export function trustedLoginHeaders(clientIp: string, serviceKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-auth-service-key': serviceKey,
    'x-original-client-ip': clientIp,
  };
}
// Same-origin login proxy: Auth Service key stays server-side.
dashboardRoutes.post('/login', rateLimit({ windowMs: 60_000, limit: 5 }), async (req, res) => {
  const credentials = z.object({ email: z.email(), password: z.string().min(1) }).safeParse(req.body);
  if (!credentials.success) { res.status(400).json({ error: 'Invalid credentials format' }); return; }
  if (!process.env.AUTH_SERVICE_URL || !process.env.AUTH_SERVICE_KEY) { res.status(503).json({ error: 'Dashboard authentication connection not configured' }); return; }
  try {
    const response = await fetch(`${process.env.AUTH_SERVICE_URL.replace(/\/$/, '')}/api/v1/auth/login`, {
      // The Auth Service validates this backend credential before using the
      // forwarded client IP for its per-IP login limiter. Browser-supplied
      // proxy headers are never forwarded as authentication claims.
      method: 'POST', headers: trustedLoginHeaders(req.ip || '127.0.0.1', process.env.AUTH_SERVICE_KEY!),
      body: JSON.stringify(credentials.data), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Do not misreport upstream rate limits/outages as wrong passwords.
      if (response.status === 401 || response.status === 400) {
        res.status(401).json({ error: 'Email or password is incorrect. Use your Auth Service account.' });
      } else if (response.status === 429 || response.status === 423) {
        // Preserve the upstream cooldown. Never disable or reset its shared
        // per-IP and per-account limits to make the dashboard login succeed.
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter && /^\d+$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter);
        res.status(429).json({ error: 'Too many login attempts. Please wait before trying again.' });
      } else if (response.status >= 500) {
        res.status(503).json({ error: 'Auth Service is temporarily unavailable. Try again shortly.' });
      } else {
        res.status(502).json({ error: 'Auth Service rejected the sign-in request.' });
      }
      return;
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('accessToken' in data) || typeof data.accessToken !== 'string') {
      res.status(502).json({ error: 'Invalid authentication response' }); return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ accessToken: data.accessToken });
  } catch { res.status(503).json({ error: 'Authentication unavailable' }); }
});
dashboardRoutes.use(requireDashboardIdentity);

const appSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(2).max(120) });
const templateSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(1).max(200000),
  requiredVariables: z.array(z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/)).max(100).default([]),
});
const userSchema = z.object({
  externalId: z.string().min(1).max(120),
  email: z.email().optional().nullable(),
  name: z.string().max(120).optional().nullable(),
  enabled: z.boolean().optional(),
});
const membershipSchema = z.object({ subject: z.string().min(1), role: z.enum(['owner','admin','editor','viewer']) });
type Role = 'owner' | 'admin' | 'editor' | 'viewer';
const rank: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

function fail(res: import('express').Response, status: number, error: string): void { res.status(status).json({ error }); }
function actor(res: import('express').Response): DashboardIdentity { return res.locals.identity as DashboardIdentity; }
async function access(res: import('express').Response, appId: string, min: Role = 'viewer'): Promise<boolean> {
  if (isPlatformAdmin(actor(res).sub)) return true;
  const member = await prisma.dashboardMembership.findUnique({
    where: { application_id_auth_subject: { application_id: appId, auth_subject: actor(res).sub } },
  });
  return !!member && (rank[member.role as Role] ?? -1) >= rank[min];
}
async function audit(res: import('express').Response, appId: string, action: string, resourceId?: string) {
  await prisma.dashboardAudit.create({ data: { application_id: appId, actor: actor(res).sub, action, resource_id: resourceId ?? null } });
}
function parse<T>(res: import('express').Response, schema: z.ZodSchema<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) { fail(res, 400, 'Invalid request'); return undefined; }
  return parsed.data;
}

// A platform operator can register apps. Each app has separately scoped templates and users.
dashboardRoutes.get('/applications', async (_req, res) => {
  const subject = actor(res).sub;
  const apps = await prisma.application.findMany({
    where: isPlatformAdmin(subject) ? {} : { memberships: { some: { auth_subject: subject } } },
    orderBy: { created_at: 'desc' }, select: { id: true, slug: true, name: true, enabled: true },
  });
  res.json({ applications: apps });
});
dashboardRoutes.post('/applications', async (req, res) => {
  if (!isPlatformAdmin(actor(res).sub)) return fail(res, 403, 'Platform admin required');
  const body = parse(res, appSchema, req.body); if (!body) return;
  const existing = await prisma.application.findUnique({ where: { slug: body.slug } });
  if (existing) return fail(res, 409, 'Application slug exists');
  const app = await prisma.application.create({ data: { ...body, memberships: {
    create: { auth_subject: actor(res).sub, role: 'owner' },
  } } });
  await audit(res, app.id, 'application.create', app.id);
  res.status(201).json({ application: app });
});

dashboardRoutes.get('/applications/:appId/templates', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId)) return fail(res, 403, 'Forbidden');
  const templates = await prisma.mailTemplate.findMany({ where: { application_id: appId }, orderBy: { updated_at: 'desc' } });
  res.json({ templates });
});
dashboardRoutes.post('/applications/:appId/templates', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'editor')) return fail(res, 403, 'Forbidden');
  const body = parse(res, templateSchema, req.body); if (!body) return;
  const existing = await prisma.mailTemplate.findUnique({ where: { application_id_slug: { application_id: appId, slug: body.slug } } });
  if (existing) return fail(res, 409, 'Template slug exists');
  const item = await prisma.mailTemplate.create({ data: {
    application_id: appId, slug: body.slug, subject: body.subject, html: body.html,
    required_variables: body.requiredVariables, published: false,
  } });
  await audit(res, appId, 'template.create', item.id);
  res.status(201).json({ template: item });
});
dashboardRoutes.patch('/applications/:appId/templates/:id', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'editor')) return fail(res, 403, 'Forbidden');
  const body = parse(res, templateSchema.omit({ slug: true }).partial().extend({ published: z.boolean().optional(), archived: z.boolean().optional() }), req.body);
  if (!body) return;
  const item = await prisma.mailTemplate.findFirst({ where: { id, application_id: appId } });
  if (!item) return fail(res, 404, 'Template not found');
  const updated = await prisma.mailTemplate.update({ where: { id }, data: {
    ...(body.subject !== undefined ? { subject: body.subject } : {}),
    ...(body.html !== undefined ? { html: body.html } : {}),
    ...(body.published !== undefined ? { published: body.published } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
    ...(body.requiredVariables !== undefined ? { required_variables: body.requiredVariables } : {}),
    version: { increment: 1 },
  } });
  await audit(res, appId, 'template.update', id);
  res.json({ template: updated });
});
dashboardRoutes.delete('/applications/:appId/templates/:id', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'editor')) return fail(res, 403, 'Forbidden');
  const updated = await prisma.mailTemplate.updateMany({ where: { id, application_id: appId }, data: { archived: true, published: false } });
  if (!updated.count) return fail(res, 404, 'Template not found');
  await audit(res, appId, 'template.archive', id);
  res.status(204).end();
});
dashboardRoutes.get('/applications/:appId/users', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId)) return fail(res, 403, 'Forbidden');
  const users = await prisma.applicationUser.findMany({ where: { application_id: appId }, take: 100, orderBy: { created_at: 'desc' } });
  res.json({ users });
});
dashboardRoutes.post('/applications/:appId/users', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'editor')) return fail(res, 403, 'Forbidden');
  const body = parse(res, userSchema, req.body); if (!body) return;
  const user = await prisma.applicationUser.upsert({
    where: { application_id_external_id: { application_id: appId, external_id: body.externalId } },
    create: { application_id: appId, external_id: body.externalId, email: body.email ?? null, name: body.name ?? null, enabled: body.enabled ?? true },
    update: {
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
  });
  await audit(res, appId, 'user.upsert', user.id);
  res.json({ user });
});
dashboardRoutes.delete('/applications/:appId/users/:id', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'editor')) return fail(res, 403, 'Forbidden');
  const updated = await prisma.applicationUser.updateMany({ where: { application_id: appId, id }, data: { enabled: false } });
  if (!updated.count) return fail(res, 404, 'User not found');
  await audit(res, appId, 'user.deactivate', id);
  res.status(204).end();
});
dashboardRoutes.get('/applications/:appId/members', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const members = await prisma.dashboardMembership.findMany({ where: { application_id: appId } });
  res.json({ members });
});
dashboardRoutes.put('/applications/:appId/members', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'owner')) return fail(res, 403, 'Forbidden');
  const body = parse(res, membershipSchema, req.body); if (!body) return;
  const member = await prisma.dashboardMembership.upsert({
    where: { application_id_auth_subject: { application_id: appId, auth_subject: body.subject } },
    create: { application_id: appId, auth_subject: body.subject, role: body.role },
    update: { role: body.role },
  });
  await audit(res, appId, 'member.upsert', member.id);
  res.json({ member });
});
dashboardRoutes.get('/applications/:appId/audit', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const events = await prisma.dashboardAudit.findMany({ where: { application_id: appId }, orderBy: { created_at: 'desc' }, take: 100 });
  res.json({ events });
});

dashboardRoutes.delete('/applications/:appId/members/:subject', async (req, res) => {
  const appId = String(req.params.appId), subject = String(req.params.subject);
  if (!await access(res, appId, 'owner')) return fail(res, 403, 'Forbidden');
  const membership = await prisma.dashboardMembership.findUnique({
    where: { application_id_auth_subject: { application_id: appId, auth_subject: subject } },
  });
  if (!membership) return fail(res, 404, 'Member not found');
  if (membership.role === 'owner') {
    const owners = await prisma.dashboardMembership.count({ where: { application_id: appId, role: 'owner' } });
    if (owners <= 1) return fail(res, 409, 'Cannot remove last owner');
  }
  await prisma.dashboardMembership.delete({ where: { id: membership.id } });
  await audit(res, appId, 'member.remove', membership.id);
  res.status(204).end();
});

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  dashboardUrl: z.url().refine(v => {
    const parsed = new URL(v);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
  }).nullable().optional(),
  welcomeEnabled: z.boolean().optional(),
  welcomeTemplate: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
  enabled: z.boolean().optional(),
});

dashboardRoutes.get('/applications/:appId/settings', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId)) return fail(res, 403, 'Forbidden');
  const app = await prisma.application.findUnique({ where: { id: appId } });
  if (!app) return fail(res, 404, 'Application not found');
  res.json({ settings: { name: app.name, slug: app.slug, enabled: app.enabled,
    dashboardUrl: app.dashboard_url, welcomeEnabled: app.welcome_enabled, welcomeTemplate: app.welcome_template } });
});
dashboardRoutes.patch('/applications/:appId/settings', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const body = parse(res, settingsSchema, req.body); if (!body) return;
  const existing = await prisma.application.findUnique({ where: { id: appId } });
  if (!existing) return fail(res, 404, 'Application not found');
  const nextEnabled = body.welcomeEnabled ?? existing.welcome_enabled;
  const nextTemplate = body.welcomeTemplate ?? existing.welcome_template;
  const nextUrl = body.dashboardUrl === undefined ? existing.dashboard_url : body.dashboardUrl;
  if (nextEnabled) {
    if (!nextUrl) return fail(res, 400, 'Dashboard URL required before enabling welcome emails');
    const template = await prisma.mailTemplate.findUnique({ where: {
      application_id_slug: { application_id: appId, slug: nextTemplate },
    } });
    if (!template || template.archived || !template.published) {
      return fail(res, 400, 'Publish the selected application template before enabling welcome emails');
    }
  }
  const updated = await prisma.application.update({ where: { id: appId }, data: {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.dashboardUrl !== undefined ? { dashboard_url: body.dashboardUrl } : {}),
    ...(body.welcomeEnabled !== undefined ? { welcome_enabled: body.welcomeEnabled } : {}),
    ...(body.welcomeTemplate !== undefined ? { welcome_template: body.welcomeTemplate } : {}),
  } });
  await audit(res, appId, 'application.settings.update');
  res.json({ settings: { name: updated.name, slug: updated.slug, enabled: updated.enabled,
    dashboardUrl: updated.dashboard_url, welcomeEnabled: updated.welcome_enabled, welcomeTemplate: updated.welcome_template } });
});
dashboardRoutes.get('/applications/:appId/credentials', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const credentials = await prisma.applicationCredential.findMany({
    where: { application_id: appId },
    select: { id: true, label: true, prefix: true, created_at: true, revoked_at: true },
    orderBy: { created_at: 'desc' },
  });
  res.json({ credentials });
});
dashboardRoutes.post('/applications/:appId/credentials', async (req, res) => {
  const appId = String(req.params.appId);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const body = parse(res, z.object({ label: z.string().trim().min(2).max(100) }), req.body);
  if (!body) return;
  const app = await prisma.application.findUnique({ where: { id: appId } });
  if (!app) return fail(res, 404, 'Application not found');
  const secret = 'nfy_' + crypto.randomBytes(32).toString('base64url');
  const credential = await prisma.applicationCredential.create({
    data: { application_id: appId, label: body.label, prefix: secret.slice(0, 12),
      key_hash: crypto.createHash('sha256').update(secret).digest('hex') },
  });
  await audit(res, appId, 'credential.create', credential.id);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ id: credential.id, prefix: credential.prefix, secret,
    message: 'Copy this secret now. It cannot be viewed again.' });
});
dashboardRoutes.delete('/applications/:appId/credentials/:id', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const changed = await prisma.applicationCredential.updateMany({
    where: { id, application_id: appId, revoked_at: null }, data: { revoked_at: new Date() },
  });
  if (!changed.count) return fail(res, 404, 'Active key not found');
  await audit(res, appId, 'credential.revoke', id);
  res.status(204).end();
});


/** Audited manual replay; never silently resend an unknown SMTP outcome. */
dashboardRoutes.post('/applications/:appId/notifications/:id/replay', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const parsed = z.object({
    reason: z.string().trim().min(10).max(500),
    acceptDuplicateRisk: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'Replay reason is required');
  const app = await prisma.application.findUnique({ where: { id: appId }, select: { slug: true } });
  if (!app) return fail(res, 404, 'Application not found');
  const row = await prisma.notification.findFirst({
    where: { id, caller_service: app.slug,
      OR: [{ application_id: appId }, { application_id: null }] },
    select: { status: true },
  });
  if (!row) return fail(res, 404, 'Notification not found');
  if (!['dead_letter', 'unknown'].includes(row.status)) {
    return fail(res, 409, 'Only dead-letter or unknown notifications can be replayed');
  }
  if (row.status === 'unknown' && !parsed.data.acceptDuplicateRisk) {
    return fail(res, 409, 'Unknown delivery may have succeeded; acknowledge duplicate risk');
  }
  try {
    const replayed = await prisma.$transaction(async tx => {
      const changed = await tx.notification.updateMany({
        where: { id, status: row.status, caller_service: app.slug },
        data: { status: 'pending', error_log: Prisma.DbNull },
      });
      if (!changed.count) return false;
      await tx.notificationOutbox.create({ data: { notification_id: id } });
      await tx.dashboardAudit.create({ data: {
        application_id: appId, actor: actor(res).sub,
        action: 'notification.replay',
        reason: parsed.data.reason,
        resource_id: id,
      } });
      return true;
    });
    if (!replayed) return fail(res, 409, 'Notification state changed; retry request was not applied');
    res.status(202).json({ notificationId: id, status: 'queued',
      message: 'Replay accepted; audit entry recorded' });
  } catch (error) {
    console.error('[dashboard] replay operation failed', error);
    return fail(res, 503, 'Replay unavailable');
  }
});

dashboardRoutes.get('/applications/:appId/notifications/:id/attempts', async (req, res) => {
  const appId = String(req.params.appId), id = String(req.params.id);
  if (!await access(res, appId, 'admin')) return fail(res, 403, 'Forbidden');
  const app = await prisma.application.findUnique({ where: { id: appId }, select: { slug: true } });
  if (!app) return fail(res, 404, 'Application not found');
  const notification = await prisma.notification.findFirst({
    where: { id, caller_service: app.slug,
      OR: [{ application_id: appId }, { application_id: null }] },
    select: { id: true },
  });
  if (!notification) return fail(res, 404, 'Notification not found');
  const attempts = await prisma.notificationAttempt.findMany({
    where: { notification_id: id },
    select: { id: true, attempt_number: true, provider: true, provider_message_id: true,
      outcome: true, retryable: true, error_code: true, started_at: true, finished_at: true },
    orderBy: { started_at: 'desc' }, take: 50,
  });
  res.set('Cache-Control', 'no-store');
  res.json({ attempts });
});
