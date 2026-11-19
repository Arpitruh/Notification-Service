import { describe, expect, it } from 'vitest';
import { allowUnknownResend, classifyDelivery, safeDeliveryError } from '../../src/services/delivery-policy.js';
describe('delivery policy', () => {
  it('defaults to no resend for ambiguous outcomes', () => {
    expect(allowUnknownResend('welcome', '')).toBe(false);
    expect(classifyDelivery({ success: false, ambiguous: true, retryable: true })).toBe('unknown');
  });
  it('allows opt-in only for matching templates', () => {
    expect(allowUnknownResend('otp', 'otp,password-reset')).toBe(true);
    expect(allowUnknownResend('welcome', 'otp,password-reset')).toBe(false);
  });
  it('redacts email addresses in provider errors', () => {
    expect(safeDeliveryError('550 user@example.com rejected')).not.toContain('user@example.com');
  });
});
