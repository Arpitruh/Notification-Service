import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

/**
 * Base class for all template-related failures. Callers can catch this to map
 * any template problem to a single response class.
 */
export class TemplateError extends Error {}

/** The requested templateId has no valid `.hbs` + `.json` file pair. */
export class TemplateNotFoundError extends TemplateError {
  constructor(
    public readonly templateId: string,
    public readonly detail?: string
  ) {
    super(
      `Template "${templateId}" was not found${detail ? ` (${detail})` : ''}.`
    );
    this.name = 'TemplateNotFoundError';
  }
}

/** The template files exist but their content is malformed. */
export class TemplateInvalidError extends TemplateError {
  constructor(
    public readonly templateId: string,
    public readonly reason: string
  ) {
    super(`Template "${templateId}" is invalid: ${reason}`);
    this.name = 'TemplateInvalidError';
  }
}

/** One or more required variables were absent from the payload. */
export class MissingTemplateVariablesError extends TemplateError {
  constructor(
    public readonly templateId: string,
    public readonly missing: string[]
  ) {
    super(
      `Template "${templateId}" is missing required variable(s): ${missing.join(', ')}.`
    );
    this.name = 'MissingTemplateVariablesError';
  }
}

export interface TemplateMetadata {
  subject: string;
  requiredVariables: string[];
}

export interface RenderedNotification {
  subject: string;
  html: string;
}

interface CompiledTemplate {
  metadata: TemplateMetadata;
  subject: HandlebarsTemplateDelegate;
  body: HandlebarsTemplateDelegate;
}

// A safe template id: lowercase alphanumeric with hyphens, must start
// alphanumeric. Blocks path traversal (`..`, `/`, absolute paths).
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Loads, compiles, caches and renders file-based Handlebars templates.
 *
 * Each template is a pair of files in the templates directory:
 *   - `<id>.hbs`  the HTML body (Handlebars)
 *   - `<id>.json` metadata: `{ subject, requiredVariables }`
 *
 * Validation is strict: an unknown id or a missing required variable throws
 * before any rendering/delivery happens.
 */
export class TemplateRenderer {
  private readonly templatesDir: string;
  private readonly cache = new Map<string, CompiledTemplate>();

  constructor(templatesDir?: string) {
    if (templatesDir) {
      this.templatesDir = templatesDir;
    } else {
      // Resolve relative to this module so it works under both `tsx` (src/)
      // and `node dist` (dist/): `<dir>/services -> <dir>/templates`.
      const here = path.dirname(fileURLToPath(import.meta.url));
      this.templatesDir = path.resolve(here, '..', 'templates');
    }
  }

  /** Throws TemplateNotFoundError/TemplateInvalidError if the id is not usable. */
  assertExists(templateId: string): void {
    this.getCompiled(templateId);
  }

  /**
   * Verifies every required variable is present (non-null, non-undefined).
   * Reports all missing names at once. Empty string counts as present.
   */
  validateVariables(templateId: string, payload: Record<string, unknown>): void {
    const { metadata } = this.getCompiled(templateId);
    const missing = metadata.requiredVariables.filter((key) => {
      const value = payload[key];
      return value === undefined || value === null;
    });
    if (missing.length > 0) {
      throw new MissingTemplateVariablesError(templateId, missing);
    }
  }

  /**
   * Existence + variable validation, then renders subject and body.
   * @throws TemplateNotFoundError | TemplateInvalidError | MissingTemplateVariablesError
   */
  render(templateId: string, payload: Record<string, unknown>): RenderedNotification {
    const compiled = this.getCompiled(templateId);
    this.validateVariables(templateId, payload);
    return {
      subject: compiled.subject(payload),
      html: compiled.body(payload),
    };
  }

  /** Loads + compiles a template on first use, then serves it from cache. */
  private getCompiled(templateId: string): CompiledTemplate {
    const cached = this.cache.get(templateId);
    if (cached) return cached;

    if (!TEMPLATE_ID_PATTERN.test(templateId)) {
      throw new TemplateNotFoundError(templateId, 'invalid template id');
    }

    const jsonPath = path.join(this.templatesDir, `${templateId}.json`);
    const hbsPath = path.join(this.templatesDir, `${templateId}.hbs`);

    if (!fs.existsSync(jsonPath)) {
      throw new TemplateNotFoundError(templateId, `missing ${templateId}.json`);
    }
    if (!fs.existsSync(hbsPath)) {
      throw new TemplateNotFoundError(templateId, `missing ${templateId}.hbs`);
    }

    const metadata = this.loadMetadata(templateId, jsonPath);

    let bodyTemplate: HandlebarsTemplateDelegate;
    let subjectTemplate: HandlebarsTemplateDelegate;
    try {
      const bodySource = fs.readFileSync(hbsPath, 'utf8');
      bodyTemplate = Handlebars.compile(bodySource, { strict: false });
      subjectTemplate = Handlebars.compile(metadata.subject, { strict: false });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new TemplateInvalidError(templateId, `failed to compile: ${reason}`);
    }

    const compiled: CompiledTemplate = {
      metadata,
      subject: subjectTemplate,
      body: bodyTemplate,
    };
    this.cache.set(templateId, compiled);
    return compiled;
  }

  private loadMetadata(templateId: string, jsonPath: string): TemplateMetadata {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new TemplateInvalidError(templateId, `invalid JSON metadata: ${reason}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new TemplateInvalidError(templateId, 'metadata must be a JSON object');
    }

    const record = parsed as Record<string, unknown>;
    const { subject, requiredVariables } = record;

    if (typeof subject !== 'string' || subject.length === 0) {
      throw new TemplateInvalidError(templateId, 'metadata.subject must be a non-empty string');
    }
    if (
      !Array.isArray(requiredVariables) ||
      !requiredVariables.every((v): v is string => typeof v === 'string')
    ) {
      throw new TemplateInvalidError(
        templateId,
        'metadata.requiredVariables must be an array of strings'
      );
    }

    return { subject, requiredVariables };
  }
}

/** Shared instance so the API and worker use one cache. */
export const templateRenderer = new TemplateRenderer();
