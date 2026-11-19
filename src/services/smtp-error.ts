export interface SmtpFailure {
  error: string;
  errorCode?: string;
  smtpResponseCode?: number;
  smtpCommand?: string;
  retryable?: boolean;
  ambiguous?: boolean;
}
const CONNECTION_ERRORS = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS', 'ETLS', 'EPROTOCOL']);
const PERMANENT_ERRORS = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE']);

/** Nodemailer error taxonomy; keep machine-readable metadata for the worker.
 * A failure during/after DATA can be ambiguous even when transport reports a
 * timeout: a remote SMTP server might have accepted the message already.
 */
export function classifySmtpError(err: unknown): SmtpFailure {
  const e = (err ?? {}) as { message?: string; code?: string; responseCode?: number; command?: string };
  const base = {
    error: String(e.message || 'Email delivery failed'),
    ...(typeof e.responseCode === 'number' ? { smtpResponseCode: e.responseCode } : {}),
    ...(typeof e.command === 'string' ? { smtpCommand: e.command } : {}),
  };
  const afterData = typeof e.command === 'string' && /^DATA\b/i.test(e.command);
  if (e.code === 'EAUTH') return { ...base, errorCode: 'SMTP_AUTH', retryable: false, ambiguous: false };
  if (typeof e.responseCode === 'number') {
    if (e.responseCode >= 400 && e.responseCode <= 499)
      return { ...base, errorCode: 'SMTP_' + e.responseCode, retryable: true, ambiguous: false };
    if (e.responseCode >= 500 && e.responseCode <= 599)
      return { ...base, errorCode: 'SMTP_' + e.responseCode, retryable: false, ambiguous: false };
    return { ...base, errorCode: 'SMTP_UNEXPECTED_RESPONSE', retryable: false, ambiguous: false };
  }
  if (e.code && PERMANENT_ERRORS.has(e.code))
    return { ...base, errorCode: e.code, retryable: false, ambiguous: false };
  if (e.code && CONNECTION_ERRORS.has(e.code))
    return { ...base, errorCode: e.code, retryable: true, ambiguous: afterData };
  // Unknown failures should not be silently classified as permanent or safe to retry.
  return { ...base, errorCode: e.code || 'SMTP_UNKNOWN_ERROR', retryable: false, ambiguous: afterData };
}

