import { describe, expect, it } from 'vitest';

import { sessionHistoryInputSchema } from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '11111111-1111-4111-a111-111111111111';

// ---------------------------------------------------------------------------
// sessionHistoryInputSchema — patientId
// ---------------------------------------------------------------------------

describe('sessionHistoryInputSchema — patientId', () => {
  it('accepts a valid uuid', () => {
    const result = sessionHistoryInputSchema.safeParse({ patientId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid patientId', () => {
    const result = sessionHistoryInputSchema.safeParse({ patientId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing patientId', () => {
    const result = sessionHistoryInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionHistoryInputSchema — limit clamping
// ---------------------------------------------------------------------------

describe('sessionHistoryInputSchema — limit', () => {
  it('defaults to 12 when omitted', () => {
    const result = sessionHistoryInputSchema.parse({ patientId: VALID_UUID });
    expect(result.limit).toBe(12);
  });

  it('clamps a limit above 50 down to 50', () => {
    const result = sessionHistoryInputSchema.parse({ patientId: VALID_UUID, limit: 999 });
    expect(result.limit).toBe(50);
  });

  it('clamps a limit below 1 up to 1', () => {
    const result = sessionHistoryInputSchema.parse({ patientId: VALID_UUID, limit: 0 });
    expect(result.limit).toBe(1);
  });

  it('keeps an in-range limit unchanged', () => {
    const result = sessionHistoryInputSchema.parse({ patientId: VALID_UUID, limit: 25 });
    expect(result.limit).toBe(25);
  });

  it('falls back to default 12 for a non-integer limit', () => {
    const result = sessionHistoryInputSchema.parse({ patientId: VALID_UUID, limit: 7.5 });
    expect(result.limit).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// sessionHistoryInputSchema — status enum
// ---------------------------------------------------------------------------

describe('sessionHistoryInputSchema — status', () => {
  it.each(['done', 'cancelled', 'no_show'] as const)('accepts status %s', (status) => {
    const result = sessionHistoryInputSchema.safeParse({ patientId: VALID_UUID, status });
    expect(result.success).toBe(true);
  });

  it('allows an omitted status', () => {
    const result = sessionHistoryInputSchema.safeParse({ patientId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = sessionHistoryInputSchema.safeParse({
      patientId: VALID_UUID,
      status: 'scheduled',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionHistoryInputSchema — cursor
// ---------------------------------------------------------------------------

describe('sessionHistoryInputSchema — cursor', () => {
  it('accepts an opaque cursor string', () => {
    const result = sessionHistoryInputSchema.safeParse({
      patientId: VALID_UUID,
      cursor: 'opaque-cursor',
    });
    expect(result.success).toBe(true);
  });
});
