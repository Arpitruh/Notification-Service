import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireDashboardIdentity, isPlatformAdmin, type DashboardIdentity } from '../middleware/dashboard-auth.js';

export const dashboardRoutes = Router();
// Same-origin login proxy: Auth Service key stays server-side.
dashboardRoutes.post('/login', rateLimit({ windowMs: 60_000, limit: 5 }), async (req, res) => {
  const credentials = z.object({ email: z.email(), password: z.string().min(1) }).safeParse(req.body);
  if (!credentials.success) { res.status(400).json({ error: 'Invalid credentials format' }); return; }
  if (!process.env.AUTH_SERVICE_URL) { res.status(503).json({ error: 'Dashboard login not configured' }); return; }
  try {
    const response = await fetch(`${process.env.AUTH_SERVICE_URL.replace(/\/$/, '')}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials.data), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) { res.status(401).json({ error: 'Invalid credentials' }); return; }
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
  await prisma.dashboardAudit.create({ data: { application_id: appId, actor: actor(res).sub, action, resource_id: resourceId } });
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
    ...body, required_variables: body.requiredVariables,
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
    create: { application_id: appId, external_id: body.externalId, email: body.email, name: body.name, enabled: body.enabled ?? true },
    update: { email: body.email, name: body.name, enabled: body.enabled },
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
