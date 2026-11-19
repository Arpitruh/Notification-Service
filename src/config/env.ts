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
  // JSON map of application IDs to API secrets; configured only in environment.
  APP_API_KEYS: z.string().default('{}'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

let applicationKeys: Record<string, string>;
try {
  const value: unknown = JSON.parse(raw.APP_API_KEYS);
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      !Object.entries(value).every(([name, key]) => /^[a-z0-9][a-z0-9-_]{1,63}$/.test(name) && typeof key === 'string' && key.length >= 32)) {
    throw new Error('Expected a JSON object mapping app IDs to secrets of at least 32 characters');
  }
  applicationKeys = value as Record<string, string>;
  if (process.env.NODE_ENV === 'production' && Object.keys(applicationKeys).length === 0) {
    throw new Error('At least one application API key must be configured in production');
  }
} catch (err) {
  console.error('Invalid APP_API_KEYS configuration:', (err as Error).message);
  process.exit(1);
}


export const ENV = {
  PORT: raw.PORT,
  APP_API_KEYS: applicationKeys,
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
