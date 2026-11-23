# Gmail API sender for portfolio projects (no domain)

This provider sends transactional messages from `arpit.yadav.projects@gmail.com` using **Gmail API over HTTPS** and the `gmail.send` OAuth scope. It is intended for low-volume portfolio and recruiter testing, not bulk mail. The Notification Service still handles application-scoped templates, audit and queuing.

## Configure Google Cloud

1. Sign into [Google Cloud Console](https://console.cloud.google.com/) as `arpit.yadav.projects@gmail.com`. Create/select a project (for example, `projects-notifications`).
2. Enable **Gmail API** in **APIs & Services → Library**.
3. In **Google Auth Platform**, configure **Branding**, **Audience**, **Data Access**, and **Clients**. Select External or the offered personal-use configuration. Add only the `https://www.googleapis.com/auth/gmail.send` scope. If using External/Testing, add the sender as a test user.
4. Create a **Web application OAuth client**. For the one-time consent via [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), add `https://developers.google.com/oauthplayground` as an **Authorized redirect URI**.
5. In OAuth Playground's settings enable **Use your own OAuth credentials** and enter the new client ID/secret locally (never send these to the chat). Request only `https://www.googleapis.com/auth/gmail.send`, authorize the dedicated sender Gmail account, exchange the authorization code and securely copy the **refresh token**.
6. In [Render's Notification Service Environment](https://dashboard.render.com/web/srv-dapnddegekts73egirp0), securely set:

```text
EMAIL_PROVIDER=gmail
GMAIL_FROM=arpit.yadav.projects@gmail.com
GMAIL_CLIENT_ID=<your client ID>
GMAIL_CLIENT_SECRET=<your client secret>
GMAIL_REFRESH_TOKEN=<your sender account refresh token>
```

Do **not** set `EMAIL_PROVIDER=gmail` until all four Gmail variables are configured. The provider fails closed on missing credentials and does not silently fall back to Resend or SMTP. All refresh tokens and secrets must be configured as server-side Render environment variables; never commit them.

## Important limitations

- **OAuth External/Testing refresh tokens generally expire after 7 days** when Gmail scopes are requested. A personal-use mode may have different rules; check what Google Auth Platform offers. An External/Production app may require Google OAuth app verification for Gmail scope use. Do not claim this configuration works indefinitely without checking the credential's authorization status.
- This is a **dedicated Gmail account**, but Gmail still enforces account sending quotas, anti-abuse checks and delivery reputation. Limit invitations, verification resends and automated messages.
- Gmail API returns an **accepted message ID**, not proof that the recipient received it. Inspect queued/sent/failed notifications and the recipient inbox.
- Avoid exposing verification or password-reset tokens in logs. The API's HTTPS transport does not log message bodies or OAuth tokens.
- Gmail API doesn't offer Resend-style idempotency. If a request may have been accepted but the response is lost, the worker marks it **unknown** to avoid duplicate sends without manual reconciliation.

## Complete LeadLoop wiring

1. In Notification Service dashboard, create application slug `leadloop` and publish `leadloop-verification`, `leadloop-password-reset` and `leadloop-invitation` templates using `{{url}}` and `{{appName}}`.
2. Generate a dedicated scoped application credential from the Notification dashboard.
3. In Vercel's LeadLoop **production** environment, configure the secret `NOTIFICATION_SERVICE_API_KEY` with that credential. The service URL and three template IDs are already configured.
4. Redeploy LeadLoop. Open its login page, enter an unverified account email and click **Resend verification email**.
5. Verify actual delivery in the recipient inbox and the Notification Service status dashboard before claiming signup works.

For an alternate transport or wider scale, verify a sending domain and use a transactional provider. Nothing here disables LeadLoop email verification.
