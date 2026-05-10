import { describe, expect, it } from 'vitest';

import { cancelSessionInputSchema } from '@/modules/agenda/lib/cancellation-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const validPayload = {
  sessionId: VALID_UUID,
  reason: 'patient_cancelled' as const,
  cancelledBy: 'patient' as const,
  chargeCancellation: false,
};

/** Build a payload with a specific key omitted. */
function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// ---------------------------------------------------------------------------
// Valid payloads
// ---------------------------------------------------------------------------

describe('cancelSessionInputSchema — valid payloads', () => {
  it('accepts a valid payload with all required fields', () => {
    const result = cancelSessionInputSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a valid payload with isReschedule = true', () => {
    const result = cancelSessionInputSchema.safeParse({
      ...validPayload,
      isReschedule: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid payload without optional isReschedule', () => {
    const result = cancelSessionInputSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isReschedule).toBeUndefined();
    }
  });

  it('accepts all valid reason values', () => {
    for (const reason of ['patient_cancelled', 'therapist_cancelled', 'unforeseen', 'other']) {
      const result = cancelSessionInputSchema.safeParse({ ...validPayload, reason });
      expect(result.success).toBe(true);
    }
  });

  it('accepts both cancelledBy values', () => {
    for (const cancelledBy of ['patient', 'therapist']) {
      const result = cancelSessionInputSchema.safeParse({ ...validPayload, cancelledBy });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid payloads — missing required fields
// ---------------------------------------------------------------------------

describe('cancelSessionInputSchema — missing required fields', () => {
  it('rejects payload with missing sessionId', () => {
    const result = cancelSessionInputSchema.safeParse(omit(validPayload, 'sessionId'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with missing reason', () => {
    const result = cancelSessionInputSchema.safeParse(omit(validPayload, 'reason'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with missing cancelledBy', () => {
    const result = cancelSessionInputSchema.safeParse(omit(validPayload, 'cancelledBy'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with missing chargeCancellation', () => {
    const result = cancelSessionInputSchema.safeParse(omit(validPayload, 'chargeCancellation'));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalid payloads — wrong types / values
// ---------------------------------------------------------------------------

describe('cancelSessionInputSchema — invalid values', () => {
  it('rejects invalid sessionId (not a UUID)', () => {
    const result = cancelSessionInputSchema.safeParse({
      ...validPayload,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid reason value', () => {
    const result = cancelSessionInputSchema.safeParse({
      ...validPayload,
      reason: 'weather',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid cancelledBy value', () => {
    const result = cancelSessionInputSchema.safeParse({
      ...validPayload,
      cancelledBy: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean chargeCancellation', () => {
    const result = cancelSessionInputSchema.safeParse({
      ...validPayload,
      chargeCancellation: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
