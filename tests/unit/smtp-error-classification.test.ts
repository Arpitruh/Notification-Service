import { describe, expect, it } from 'vitest';
import { classifySmtpError } from '../../src/services/smtp-error.js';
describe('SMTP transport classification', () => {
  it('retries SMTP 421 and permanently rejects SMTP 550', () => {
    expect(classifySmtpError({ responseCode: 421, code: 'EENVELOPE' }).retryable).toBe(true);
    expect(classifySmtpError({ responseCode: 550, code: 'EENVELOPE' }).retryable).toBe(false);
  });
  it('does not retry authentication failures and unexpected SMTP codes', () => {
    expect(classifySmtpError({ code: 'EAUTH' }).retryable).toBe(false);
    expect(classifySmtpError({ responseCode: 250 }).retryable).toBe(false);
  });
  it('flags DATA timeouts as ambiguous', () => {
    expect(classifySmtpError({ code: 'ETIMEDOUT', command: 'DATA' })).toMatchObject({ retryable: true, ambiguous: true });
    expect(classifySmtpError({ code: 'ECONNRESET', command: 'CONNECT' })).toMatchObject({ retryable: true, ambiguous: false });
  });
});
