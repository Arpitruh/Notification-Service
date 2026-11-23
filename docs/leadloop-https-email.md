# Free HTTPS email delivery for LeadLoop

Render Free web services block outbound SMTP ports 25, 465 and 587. The Notification Service supports Resend's HTTPS API on port 443 when `RESEND_API_KEY` is present; otherwise it retains its existing SMTP provider.

## Before using real accounts

1. Create a **free** Resend account, verify a domain you control and create an API key with sending permissions. A sender on an unverified domain will not deliver production emails. Resend free-tier limits and domain verification requirements apply.
2. In Render's `notification-service` environment, set `RESEND_API_KEY` and `RESEND_FROM` (for example `LeadLoop <verify@your-verified-domain.example>`). Never commit the key. Deploy/restart and confirm both `/health` and `/ready` return 200.
3. In Notification Service dashboard, create an application with slug `leadloop`, publish these HTML email templates with required variable names `url`, `appName`, and `subject`:
   - `leadloop-verification`: subject "Verify your LeadLoop email"; HTML includes a safe link to `{{url}}`
   - `leadloop-password-reset`: subject "Reset your LeadLoop password"; HTML includes a safe link to `{{url}}`
   - `leadloop-invitation`: subject "You're invited to LeadLoop"; HTML includes a safe link to `{{url}}`
   Use the dashboard API to generate an application credential. Its secret is only shown once.
4. In Vercel LeadLoop's **production** environment, configure:
   - `NOTIFICATION_SERVICE_URL=https://notification-service-18dh.onrender.com`
   - `NOTIFICATION_SERVICE_API_KEY=<app credential created above>`
   - `NOTIFICATION_TEMPLATE_VERIFICATION=leadloop-verification`
   - `NOTIFICATION_TEMPLATE_PASSWORD_RESET=leadloop-password-reset`
   - `NOTIFICATION_TEMPLATE_INVITATION=leadloop-invitation`
   Redeploy LeadLoop after changing its environment variables.
5. On LeadLoop's login page, enter the unverified account email and click **Resend verification email**. Check the application's delivery ledger and the recipient inbox. An HTTP 202 from Notification Service means queued, **not delivered**.

Do not disable `requireEmailVerification` or manually change database users to verified. Never log full verification URLs: they contain one-time secrets.
