# Requirements — File-Based Handlebars Notification Templates

## Introduction

The notification service currently sends emails by echoing the raw `templateId`
into the subject and dumping `payloadData` as JSON into the body. There is no
concept of a real template, no rendering, and no validation that a requested
template or its variables exist.

This feature introduces a file-based template system. Templates are stored on
disk as Handlebars (`.hbs`) files paired with a JSON metadata file that carries
the subject line and the list of required variables. A `TemplateRenderer`
service loads and compiles templates at run time based on the caller-provided
`templateId`, merges `payloadData` into them, and returns a rendered subject and
HTML body. Validation is **strict**: an unknown `templateId` or a missing
required variable is rejected before the email provider is ever called.

Two templates ship initially:

- `welcome` — variables: `name`, `dashboardUrl`
- `forgot-password` — variables: `name`, `resetUrl`, `expiresInMinutes`

## Glossary

- **Template ID** — the string key identifying a template (e.g. `welcome`). Maps
  to a `<id>.hbs` body file and a `<id>.json` metadata file.
- **Template metadata** — the JSON config describing a template's `subject`
  string (itself a Handlebars template) and its `requiredVariables` list.
- **Payload data** — the variable map (`payloadData`) supplied by the caller that
  is merged into the template at render time.
- **Rendered notification** — the output of the renderer: a concrete `subject`
  and `html` string with all variables substituted.
- **Strict validation** — the policy of rejecting a request early if the template
  does not exist or any required variable is absent/undefined.

## Requirements

### Requirement 1 — Template existence validation

**User Story:** As a service integrator, I want a send request with an unknown
`templateId` to be rejected up front, so that I get a clear error instead of a
malformed or empty email being delivered.

#### Acceptance Criteria

1. WHEN a send request is received with a `templateId` that has no corresponding
   template files THEN the system SHALL reject the request with a validation
   error identifying the unknown `templateId`.
2. WHEN a `templateId` exists as a `.hbs` file but is missing its `.json`
   metadata file (or vice versa) THEN the system SHALL treat the template as
   invalid and reject the request with an error naming the missing file.
3. WHEN template existence is checked THEN the system SHALL NOT enqueue the job
   or call any email provider for an unknown template.
4. IF template existence is validated at API request time THEN the system SHALL
   respond with HTTP 400 and a body that names the offending `templateId`.

### Requirement 2 — Required variable validation

**User Story:** As a service integrator, I want a send request that omits a
required template variable to be rejected, so that I never send an email with
blank or broken placeholders.

#### Acceptance Criteria

1. WHEN a template declares `requiredVariables` in its metadata THEN the system
   SHALL verify every listed variable is present in `payloadData` before
   rendering.
2. IF a required variable is missing from `payloadData`, or is `undefined` or
   `null` THEN the system SHALL reject the request with a validation error that
   lists every missing variable name.
3. WHEN more than one required variable is missing THEN the system SHALL report
   all missing variables in a single error rather than failing on the first.
4. WHEN `payloadData` contains extra variables not listed in `requiredVariables`
   THEN the system SHALL allow them and render normally (extra keys are not an
   error).
5. IF variable validation runs at API request time THEN the system SHALL respond
   with HTTP 400 and a body listing the missing variable names.

### Requirement 3 — Template rendering

**User Story:** As a service integrator, I want the template's subject and body
populated with my payload variables, so that recipients receive a properly
formatted, human-readable email.

#### Acceptance Criteria

1. WHEN a valid `templateId` and complete `payloadData` are provided THEN the
   system SHALL render the `.hbs` body file with `payloadData` as the Handlebars
   context and produce an HTML string.
2. WHEN rendering a template THEN the system SHALL render the metadata `subject`
   string as a Handlebars template using the same `payloadData` context.
3. WHEN rendering completes THEN the system SHALL return an object containing the
   rendered `subject` and rendered `html`.
4. WHEN a Handlebars placeholder references a variable present in `payloadData`
   THEN the system SHALL substitute its value; HTML-significant characters SHALL
   be escaped by Handlebars' default escaping to prevent injection.
5. IF the `.hbs` or `.json` file content is malformed (invalid Handlebars syntax
   or invalid JSON) THEN the system SHALL surface a clear rendering/parse error
   and SHALL NOT deliver a partial email.

### Requirement 4 — Runtime loading and caching

**User Story:** As an operator, I want templates loaded efficiently at run time,
so that repeated sends do not re-read and re-compile files on every request.

#### Acceptance Criteria

1. WHEN a template is rendered for the first time THEN the system SHALL read its
   `.hbs` and `.json` files from disk and compile the Handlebars templates.
2. WHEN the same `templateId` is rendered again THEN the system SHALL reuse the
   compiled template from an in-memory cache rather than re-reading disk.
3. WHEN the service starts THEN the system SHALL resolve the templates directory
   relative to the compiled module location so it works under both `tsx` (dev)
   and `node dist` (prod).
4. IF a template file does not exist at first load THEN the system SHALL raise a
   `TemplateNotFoundError` rather than caching a negative result that hides a
   later-added template within the same process run.

### Requirement 5 — Provider integration

**User Story:** As a maintainer, I want the email provider to send the rendered
subject and body, so that the raw-JSON debug email is replaced by real content.

#### Acceptance Criteria

1. WHEN the email provider sends a notification THEN the system SHALL use the
   renderer's output for the `subject` and `html` fields instead of the previous
   raw `templateId`/JSON interpolation.
2. WHEN rendering fails inside the worker THEN the system SHALL treat it as an
   unrecoverable error so the job is not retried against a template that cannot
   render.
3. WHEN the email is dispatched THEN the system SHALL preserve existing behavior
   for `from`, `to`, idempotency, metrics, and audit-status updates.

### Requirement 6 — Initial templates

**User Story:** As an integrator, I want ready-to-use `welcome` and
`forgot-password` templates, so that I can send those emails without authoring
templates myself.

#### Acceptance Criteria

1. WHEN the feature is delivered THEN the system SHALL include a `welcome`
   template whose metadata declares required variables `name` and
   `dashboardUrl`.
2. WHEN the feature is delivered THEN the system SHALL include a
   `forgot-password` template whose metadata declares required variables `name`,
   `resetUrl`, and `expiresInMinutes`.
3. WHEN either template is rendered with all required variables THEN the system
   SHALL produce a valid HTML email whose subject and body reflect the supplied
   values.
