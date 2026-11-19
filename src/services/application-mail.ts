import Handlebars from 'handlebars';
import { prisma } from '../db/prisma.js';

export interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Resolves the published template in the authenticated application.
 * Never fetches another application's template, even when slugs match.
 * Values are escaped by Handlebars by default.
 */
export async function renderApplicationMail(
  applicationSlug: string,
  templateSlug: string,
  payload: Record<string, unknown>
): Promise<{ foundApp: boolean; rendered?: RenderedEmail; error?: string }> {
  const app = await prisma.application.findUnique({ where: { slug: applicationSlug } });
  if (!app) return { foundApp: false }; // Backwards compatibility for pre-migration file templates.
  if (!app.enabled) return { foundApp: true, error: 'Application disabled' };
  const template = await prisma.mailTemplate.findUnique({
    where: { application_id_slug: { application_id: app.id, slug: templateSlug } },
  });
  if (!template || !template.published || template.archived) {
    return { foundApp: true, error: 'Unknown or unpublished application template' };
  }
  const required: unknown = template.required_variables;
  if (!Array.isArray(required) || !required.every(v => typeof v === 'string')) {
    return { foundApp: true, error: 'Invalid template variable configuration' };
  }
  const missing = required.filter(name => payload[name] === null || payload[name] === undefined);
  if (missing.length > 0) {
    return { foundApp: true, error: 'Missing variables: ' + missing.join(', ') };
  }
  try {
    const subject = Handlebars.compile(template.subject)(payload);
    const html = Handlebars.compile(template.html)(payload);
    return { foundApp: true, rendered: { subject, html } };
  } catch {
    return { foundApp: true, error: 'Unable to render application template' };
  }
}
