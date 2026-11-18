import { describe, expect, it } from 'vitest';
import { scopedIdempotencyKey, sameNotificationIntent, stableJson } from './idempotency.js';

describe('per-client idempotency', () => {
  it('is stable for retries but different across clients', () => {
    expect(scopedIdempotencyKey('crm', 'lead-123')).toBe(scopedIdempotencyKey('crm', 'lead-123'));
    expect(scopedIdempotencyKey('crm', 'lead-123')).not.toBe(scopedIdempotencyKey('jobs', 'lead-123'));
    expect(scopedIdempotencyKey('crm')).not.toBe(scopedIdempotencyKey('crm'));
  });
  it('canonicalizes JSON objects independent of field order', () => {
    expect(stableJson({ z: 1, a: { y: 2, x: 3 } })).toBe(stableJson({ a: { x: 3, y: 2 }, z: 1 }));
  });
  it('detects a conflicting payload for a reused idempotency key', () => {
    const saved = {
      recipient:'u@example.com', channel:'email', template_id:'welcome',
      payload_data:{ name:'A', url:'https://example.com' }, priority:0, scheduled_for:null,
    };
    expect(sameNotificationIntent(saved, {
      recipient:'u@example.com', channel:'email', templateId:'welcome',
      payloadData:{ url:'https://example.com', name:'A' }, priority:0, scheduledFor:null,
    })).toBe(true);
    expect(sameNotificationIntent(saved, {
      recipient:'other@example.com', channel:'email', templateId:'welcome',
      payloadData:{ name:'A', url:'https://example.com' }, priority:0, scheduledFor:null,
    })).toBe(false);
  });
});
