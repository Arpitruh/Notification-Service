# Tasks — File-Based Handlebars Notification Templates

Sequential implementation plan. Each task lists the requirements it satisfies.
Complete tasks in order; later tasks depend on earlier ones.

- [ ] 1. Add the `handlebars` dependency
  - Install `handlebars` as a runtime dependency (`npm install handlebars`).
  - Confirm its bundled types resolve under `module: nodenext` (no `@types`
    package required).
  - _Requirements: 3.1, 3.2_

- [ ] 2. Create the templates directory and initial template files
  - Create `src/templates/`.
  - Add `welcome.json` (`subject` + `requiredVariables: ["name","dashboardUrl"]`)
    and `welcome.hbs` (HTML using `{{name}}` and `{{dashboardUrl}}`).
  - Add `forgot-password.json` (`subject` + `requiredVariables:
    ["name","resetUrl","expiresInMinutes"]`) and `forgot-password.hbs` (HTML
    using `{{name}}`, `{{resetUrl}}`, `{{expiresInMinutes}}`).
  - Use only escaped `{{ }}` interpolation (no triple-stache).
  - _Requirements: 6.1, 6.2, 6.3, 3.4_

- [ ] 3. Implement error types
  - In `src/services/template-renderer.ts`, define `TemplateError` (base) and
    `TemplateNotFoundError`, `TemplateInvalidError`,
    `MissingTemplateVariablesError` with the structured fields from the design
    (`templateId`, `missing`, `reason`, `detail`).
  - _Requirements: 1.1, 1.2, 2.2, 3.5_

- [ ] 4. Implement the `TemplateRenderer` service
  - Resolve `templatesDir` from `import.meta.url` (`../templates`) so it works
    under `tsx` and `node dist`.
  - Implement `templateId` slug validation (`^[a-z0-9][a-z0-9-]*$`); invalid ids
    surface as `TemplateNotFoundError` (path-traversal guard).
  - Implement internal `getCompiled(templateId)`: read `.json` + `.hbs`, throw
    `TemplateNotFoundError` on a missing file, `TemplateInvalidError` on bad
    JSON/shape, compile subject + body with Handlebars, cache in a `Map`.
  - Implement `assertExists`, `validateVariables` (collect ALL missing;
    treat `undefined`/`null` as missing, empty string as present), and `render`
    (existence → variables → render subject + html).
  - Export a shared singleton `templateRenderer`.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Add API request-time strict validation
  - After the existing zod check in
    `src/api/middleware/validate.middleware.ts` (or a chained `validateTemplate`
    middleware), call `templateRenderer.assertExists` and
    `validateVariables` for template-driven channels.
  - Map `TemplateNotFoundError` → HTTP 400 `{ error, templateId }` and
    `MissingTemplateVariablesError` → HTTP 400 `{ error, templateId, missing }`;
    forward other errors to the global handler.
  - Ensure no job is enqueued when validation fails.
  - _Requirements: 1.3, 1.4, 2.5_

- [ ] 6. Integrate the renderer into the email provider
  - In `src/providers/email.provider.ts`, replace the raw
    `htmlBody`/`subject` construction with
    `templateRenderer.render(templateId, payloadData)` and send the rendered
    `subject`/`html`.
  - Keep `from`, `to`, return shape (`DeliveryResult`), and error handling
    intact.
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.3_

- [ ] 7. Add worker defense-in-depth mapping
  - In `src/workers/notification.worker.ts`, wrap the email send so any
    `TemplateError` is rethrown as `UnrecoverableError` (no retry), letting the
    existing `failed` handler route it to `dead_letter`.
  - _Requirements: 5.2_

- [ ] 8. Ensure templates ship to `dist` for production builds
  - Update the `build` script so `src/templates/*.{hbs,json}` are copied to
    `dist/templates/` after `tsc` (e.g. a small copy step or `cpy`/`cp -r`).
  - Verify `node dist/server.js` can resolve templates.
  - _Requirements: 4.3, 5.1_

- [ ] 9. Set up the test runner and write `TemplateRenderer` unit tests
  - Add `vitest` (dev dependency) and a `test` script that runs once (not watch).
  - Cover: unknown id → `TemplateNotFoundError`; single/multiple missing vars →
    `MissingTemplateVariablesError` listing all; extra vars allowed; valid
    render substitutes values; HTML-significant value is escaped; cache reuse
    (fs read spied/called once); `welcome` and `forgot-password` render with
    their required vars.
  - _Requirements: 1.1, 2.2, 2.3, 2.4, 3.1, 3.4, 4.2, 6.1, 6.2, 6.3_

- [ ] 10. End-to-end verification
  - Run `tsc --noEmit` and the test suite; fix any failures.
  - Send a `welcome` email via the API with valid vars and confirm HTTP 202 +
    rendered email; send with a missing var and confirm HTTP 400 listing it;
    send with an unknown `templateId` and confirm HTTP 400.
  - Confirm a bad template reaching the worker lands in `dead_letter`, not an
    endless retry.
  - _Requirements: 1.4, 2.5, 3.3, 5.1, 5.2, 6.3_
