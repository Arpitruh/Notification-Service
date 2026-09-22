import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';
export class EmailProvider {
    channel = 'email';
    transporter = nodemailer.createTransport({
        host: ENV.SMTP.host,
        port: ENV.SMTP.port,
        auth: ENV.SMTP.user ? { user: ENV.SMTP.user, pass: ENV.SMTP.pass } : undefined,
    });
    async send(payload) {
        try {
            const htmlBody = `<p>Template: ${payload.templateId}</p><pre>${JSON.stringify(payload.payloadData, null, 2)}</pre>`;
            const info = await this.transporter.sendMail({
                from: '"Notification Service" <no-reply@notifications.internal>',
                to: payload.recipient,
                subject: `Notification: ${payload.templateId}`,
                html: htmlBody,
            });
            return { success: true, providerMessageId: info.messageId };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
}
//# sourceMappingURL=email.provider.js.map