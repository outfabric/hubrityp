import { describe, expect, it } from 'vitest';

import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('generateIdempotencyKey — determinism', () => {
  it('produces the same output for the same input', () => {
    const key1 = generateIdempotencyKey('session-123', 'early');
    const key2 = generateIdempotencyKey('session-123', 'early');

    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

describe('generateIdempotencyKey — uniqueness', () => {
  it('produces different keys for different kinds', () => {
    const earlyKey = generateIdempotencyKey('session-123', 'early');
    const finalKey = generateIdempotencyKey('session-123', 'final');

    expect(earlyKey).not.toBe(finalKey);
  });

  it('produces different keys for different session IDs', () => {
    const key1 = generateIdempotencyKey('session-aaa', 'early');
    const key2 = generateIdempotencyKey('session-bbb', 'early');

    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

describe('generateIdempotencyKey — output format', () => {
  it('returns a 64-character hex string', () => {
    const key = generateIdempotencyKey('any-session', 'any-kind');

    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns lowercase hex only', () => {
    const key = generateIdempotencyKey('SESSION-UPPER', 'VIDEO');

    expect(key).toMatch(/^[0-9a-f]+$/);
  });
});
