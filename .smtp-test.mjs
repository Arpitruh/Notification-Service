import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

console.log('Using SMTP =>', { host, port, user, passLen: pass?.length });

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: process.env.SMTP_SECURE === 'true',
  auth: user ? { user, pass } : undefined,
});

try {
  await transporter.verify();
  console.log('VERIFY_OK: SMTP connection + auth succeeded');
} catch (e) {
  console.error('VERIFY_FAILED:', e.message);
  process.exitCode = 1;
}
