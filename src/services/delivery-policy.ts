import type { DeliveryResult } from '../providers/email.provider.js';

export type DeliveryDecision = 'retry' | 'permanent' | 'unknown';

/** Ambiguous SMTP acceptance is not automatically safe to retry.
 * Opt in per template with UNKNOWN_OUTCOME_RESEND_TEMPLATES, e.g.
 * "otp,password-reset". Leave unset to require manual reconciliation.
 */
export function allowUnknownResend(templateId: string, raw = process.env.UNKNOWN_OUTCOME_RESEND_TEMPLATES): boolean {
  if (!raw) return false;
  return raw.split(',').map(v => v.trim()).filter(Boolean).includes(templateId);
}

export function classifyDelivery(result: DeliveryResult): DeliveryDecision {
  if (result.ambiguous) return 'unknown';
  if (result.retryable === false) return 'permanent';
  if (result.retryable === true) return 'retry';
  // For mock SMS / legacy providers with no structured metadata, preserve
  // their historical retry behavior; SMTP always returns metadata now.
  return 'retry';
}

export function safeDeliveryError(message: string): string {
  return message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[redacted-email]').slice(0, 300);
}
