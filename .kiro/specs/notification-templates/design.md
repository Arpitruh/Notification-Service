# Design — File-Based Handlebars Notification Templates

## Overview

This design adds a `TemplateRenderer` service that loads Handlebars templates and
their JSON metadata from disk, validates strictly, compiles and caches them, and
renders a concrete `{ subject, html }` for a given `templateId` and payload.

Strict validation happens in two places:

1. **API request time** (middleware/service check) — so callers get a fast
   HTTP 400 with a precise reason before anything is enqueued.
2. **Worker render time** (defense in depth) — the same renderer is the single
   source of truth, so if a job somehow reaches the worker for a bad template,
   rendering fails as an `UnrecoverableError` (no pointless retries).

The email provider stops hand-rolling the subject/body and instead sends the
renderer's output.

## Directory & file schema

```
src/
  templates/
    welcome.hbs
    welcome.json
    forgot-password.hbs
    forgot-password.json
  services/
    template-renderer.ts        # TemplateRenderer + errors
```

### Metadata file (`<id>.json`)

```json
{
  "subject": "Welcome to the service, {{name}}!",
  "requiredVariables": ["name", "dashboardUrl"]
}
```

- `subject` — a Handlebars string rendered with the same payload context.
- `requiredVariables` — array of variable names that MUST be present (non-null,
  non-undefined) in `payloadData`.

### Body file (`<id>.hbs`)

A standard Handlebars HTML document, e.g.:

```hbs
<h1>Hi {{name}},</h1>
<p>Your account is ready. Open your dashboard:</p>
<p><a href="{{dashboardUrl}}">{{dashboardUrl}}</a></p>
```

Handlebars default escaping (`{{ }}`) is used for all interpolation so payload
values cannot inject markup. `{{{ }}}` (unescaped) is intentionally avoided.

## Directory resolution (dev + prod)

Templates are shipped as non-code assets and must resolve under both `tsx`
(source at `src/`) and `node dist` (compiled to `dist/`).

- Resolve the templates directory relative to the current module using
  `import.meta.url`:

  ```ts
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../src/services or .../dist/services
  const templatesDir = path.resolve(here, '..', 'templates');
  ```

- Because `tsc` does not copy `.hbs`/`.json` into `dist/`, the build step MUST
  copy `src/templates` → `dist/templates`. This is handled as a `build` script
  addition (see tasks). Under `tsx` dev, files are read straight from `src/`.

## Component: `TemplateRenderer`

```ts
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

export class TemplateRenderer {
  constructor(templatesDir?: string);

  /** Throws TemplateNotFoundError if the id has no valid file pair. */
  assertExists(templateId: string): void;

  /** Throws MissingTemplateVariablesError listing every absent required var. */
  validateVariables(templateId: string, payload: Record<string, unknown>): void;

  /** Full path: existence + variable checks + render. Returns subject + html. */
  render(templateId: string, payload: Record<string, unknown>): RenderedNotification;
}
```

### Responsibilities

- **Load & compile** the `.json` + `.hbs` pair on first use for a `templateId`.
- **Cache** the compiled result in an in-memory `Map<string, CompiledTemplate>`.
- **Validate** existence and required variables strictly.
- **Render** subject and body from the payload.

### Load algorithm (`getCompiled(templateId)` — internal)

1. If `cache.has(templateId)` return the cached entry.
2. Sanitize `templateId` (see Security) and build `jsonPath` and `hbsPath`.
3. If either file is missing → throw `TemplateNotFoundError(templateId, missingPath)`.
4. `JSON.parse` the metadata; if parse fails or shape is invalid (no string
   `subject`, no string[] `requiredVariables`) → throw `TemplateInvalidError`.
5. `Handlebars.compile` the `subject` string and the `.hbs` body.
6. Store `{ metadata, subject, body }` in the cache and return it.

### `render` algorithm

1. `const compiled = getCompiled(templateId);` (covers existence)
2. `validateVariables` against `compiled.metadata.requiredVariables`.
3. `subject = compiled.subject(payload)`, `html = compiled.body(payload)`.
4. Return `{ subject, html }`.

### `validateVariables` rule

A variable is "missing" if the key is absent, `undefined`, or `null`. Empty
string is considered present (caller's choice to send empty). Collect all
missing names and throw once:

```
throw new MissingTemplateVariablesError(templateId, missing); // missing: string[]
```

## Error contracts

All custom errors extend a common base and carry structured fields so callers can
translate them to HTTP responses.

```ts
export class TemplateError extends Error {}                       // base

export class TemplateNotFoundError extends TemplateError {
  constructor(public templateId: string, public detail?: string) { ... }
}

export class TemplateInvalidError extends TemplateError {
  constructor(public templateId: string, public reason: string) { ... }
}

export class MissingTemplateVariablesError extends TemplateError {
  constructor(public templateId: string, public missing: string[]) { ... }
}
```

| Error | Cause | HTTP mapping (API) | Worker mapping |
|---|---|---|---|
| `TemplateNotFoundError` | Unknown id / missing file | 400 `{ error, templateId }` | `UnrecoverableError` |
| `MissingTemplateVariablesError` | Required var absent | 400 `{ error, templateId, missing }` | `UnrecoverableError` |
| `TemplateInvalidError` | Bad JSON / Handlebars | 400 at request time; 500-class otherwise | `UnrecoverableError` |

## Integration points

### 1. Shared singleton

Export a ready-to-use instance so the API and worker share the same cache:

```ts
// src/services/template-renderer.ts
export const templateRenderer = new TemplateRenderer();
```

### 2. API request-time validation

Add validation after the existing zod schema check in
`src/api/middleware/validate.middleware.ts` (or a dedicated
`validateTemplate` middleware chained after `validateSendNotification`, only for
requests whose `channel` uses templates):

```ts
try {
  templateRenderer.assertExists(templateId);
  templateRenderer.validateVariables(templateId, payloadData);
  next();
} catch (err) {
  if (err instanceof TemplateNotFoundError)
    return res.status(400).json({ error: 'Unknown templateId', templateId: err.templateId });
  if (err instanceof MissingTemplateVariablesError)
    return res.status(400).json({ error: 'Missing template variables', templateId: err.templateId, missing: err.missing });
  return next(err);
}
```

This satisfies Req 1.4 and Req 2.5 (HTTP 400 with precise detail) and Req 1.3
(no enqueue for bad templates).

### 3. Email provider uses rendered output

`src/providers/email.provider.ts` changes `send` to render first:

```ts
const { subject, html } = templateRenderer.render(payload.templateId, payload.payloadData);
const info = await this.transporter.sendMail({
  from: ENV.SMTP.from,
  to: payload.recipient,
  subject,
  html,
});
```

The existing `CompiledNotification` interface (`recipient`, `templateId`,
`payloadData`) is unchanged, so the worker call site stays the same.

### 4. Worker defense in depth

In `src/workers/notification.worker.ts`, wrap the email branch so a
`TemplateError` becomes `UnrecoverableError` (Req 5.2):

```ts
if (channel === 'email') {
  try {
    result = await emailProvider.send({ recipient, templateId, payloadData });
  } catch (err) {
    if (err instanceof TemplateError)
      throw new UnrecoverableError(err.message);
    throw err;
  }
}
```

The worker's existing `failed` handler already routes `UnrecoverableError` and
exhausted retries to `dead_letter`, so no change is needed there.

## Caching strategy

- **In-memory `Map`**, process-lifetime, keyed by `templateId`.
- Compiled once, reused thereafter (Req 4.1, 4.2).
- No negative caching: a `TemplateNotFoundError` is thrown, not cached, so adding
  a file later in the same process is picked up on the next call (Req 4.4).
- Cache invalidation/hot-reload is out of scope; templates change via redeploy.

## Security considerations

- **Path traversal:** `templateId` is caller-supplied. Before building file
  paths, reject any id that is not a safe slug (`^[a-z0-9][a-z0-9-]*$`). This
  prevents `../` escapes and absolute paths. An invalid slug is treated as
  `TemplateNotFoundError`.
- **HTML injection:** rely on Handlebars default escaping (`{{ }}`); never use
  triple-stache for payload values.
- **No secret exposure:** templates contain no credentials; only presentation.

## Dependencies

- Add `handlebars` (runtime dependency). No `@types` package needed —
  `handlebars` ships its own TypeScript types.

## Testing strategy

Unit tests for `TemplateRenderer` (no network, no DB):

- Unknown `templateId` → `TemplateNotFoundError`.
- Missing one required variable → `MissingTemplateVariablesError` naming it.
- Missing multiple → error lists all missing names (Req 2.3).
- Extra variables → render succeeds (Req 2.4).
- Valid render → subject and html contain substituted values (Req 3).
- HTML-significant payload value → escaped in output (Req 3.4).
- Cache → second render does not re-read disk (spy on fs read).
- `welcome` and `forgot-password` render end-to-end with their required vars
  (Req 6).

A test runner is not yet configured; tasks include adding `vitest` and a `test`
script (run in single-shot mode, not watch).
