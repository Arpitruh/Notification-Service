import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();
const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_PHONE_NUMBER: z.string().default(''),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
}
const raw = parsed.data;
export const ENV = {
    PORT: raw.PORT,
    DATABASE_URL: raw.DATABASE_URL,
    REDIS_HOST: raw.REDIS_HOST,
    REDIS_PORT: raw.REDIS_PORT,
    SMTP: {
        host: raw.SMTP_HOST,
        port: raw.SMTP_PORT,
        user: raw.SMTP_USER,
        pass: raw.SMTP_PASS,
    },
    TWILIO: {
        accountSid: raw.TWILIO_ACCOUNT_SID,
        authToken: raw.TWILIO_AUTH_TOKEN,
        phoneNumber: raw.TWILIO_PHONE_NUMBER,
    },
};
//# sourceMappingURL=env.js.map