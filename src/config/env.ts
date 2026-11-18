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
  // true only for implicit TLS on port 465; false for STARTTLS ports (587/2525).
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_FROM: z.string().min(1).default('Notification Service <no-reply@example.com>'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_PHONE_NUMBER: z.string().default(''),
  NOTIFICATION_CLIENTS_JSON: z.string().optional(),
  METRICS_API_KEY: z.string().optional(),
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
  NOTIFICATION_CLIENTS_JSON: raw.NOTIFICATION_CLIENTS_JSON,
  METRICS_API_KEY: raw.METRICS_API_KEY,
  DATABASE_URL: raw.DATABASE_URL,
  REDIS_HOST: raw.REDIS_HOST,
  REDIS_PORT: raw.REDIS_PORT,
  SMTP: {
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    user: raw.SMTP_USER,
    pass: raw.SMTP_PASS,
    secure: raw.SMTP_SECURE,
    from: raw.MAIL_FROM,
  },
  TWILIO: {
    accountSid: raw.TWILIO_ACCOUNT_SID,
    authToken: raw.TWILIO_AUTH_TOKEN,
    phoneNumber: raw.TWILIO_PHONE_NUMBER,
  },
} as const;
