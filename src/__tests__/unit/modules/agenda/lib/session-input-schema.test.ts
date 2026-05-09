import { describe, expect, it } from 'vitest';

import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';

/**
 * Canonical valid payload for a regular (non-blocking) session.
 */
const VALID_SESSION = {
  patient_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  start_at: '2026-06-15T14:00:00Z',
  duration_minutes: 50,
};

/**
 * Canonical valid payload for a blocking slot.
 */
const VALID_BLOCKING = {
  is_blocking: true,
  blocking_title: 'Almoço',
  start_at: '2026-06-15T12:00:00Z',
  duration_minutes: 60,
};

type FieldErrorRecord = Record<string, string[] | undefined>;

const fieldErrorsOf = (
  result: ReturnType<typeof sessionInputSchema.safeParse>,
): FieldErrorRecord => {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error.flatten().fieldErrors;
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('sessionInputSchema — happy path', () => {
  it('accepts a valid regular session with patient_id', () => {
    const result = sessionInputSchema.safeParse(VALID_SESSION);
    expect(result.success).toBe(true);
  });

  it('accepts a valid blocking slot with blocking_title', () => {
    const result = sessionInputSchema.safeParse(VALID_BLOCKING);
    expect(result.success).toBe(true);
  });

  it('accepts a full session payload with all optional fields', () => {
    const result = sessionInputSchema.safeParse({
      ...VALID_SESSION,
      location_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      modality: 'online',
      amount: '250.00',
      notes: 'Primeira sessão.',
      color: '#10B981',
      force_conflict: false,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conditional: is_blocking / patient_id / blocking_title
// ---------------------------------------------------------------------------

describe('sessionInputSchema — blocking vs. regular conditional', () => {
  it('accepts blocking slot without patient_id', () => {
    const result = sessionInputSchema.safeParse(VALID_BLOCKING);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.patient_id).toBeUndefined();
  });

  it('rejects regular session (is_blocking=false) without patient_id', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({
        start_at: '2026-06-15T14:00:00Z',
        duration_minutes: 50,
        // is_blocking defaults to false, patient_id absent
      }),
    );
    expect(errs.patient_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects blocking slot without blocking_title', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({
        is_blocking: true,
        start_at: '2026-06-15T12:00:00Z',
        duration_minutes: 60,
        // blocking_title absent
      }),
    );
    expect(errs.blocking_title?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects blocking slot with empty blocking_title', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({
        ...VALID_BLOCKING,
        blocking_title: '   ',
      }),
    );
    expect(errs.blocking_title?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// duration_minutes
// ---------------------------------------------------------------------------

describe('sessionInputSchema — duration_minutes', () => {
  it('rejects duration below 15 minutes', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, duration_minutes: 14 }),
    );
    expect(errs.duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects duration above 480 minutes', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, duration_minutes: 481 }),
    );
    expect(errs.duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts duration of exactly 15 minutes', () => {
    const result = sessionInputSchema.safeParse({
      ...VALID_SESSION,
      duration_minutes: 15,
    });
    expect(result.success).toBe(true);
  });

  it('accepts duration of exactly 480 minutes', () => {
    const result = sessionInputSchema.safeParse({
      ...VALID_SESSION,
      duration_minutes: 480,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer duration', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, duration_minutes: 50.5 }),
    );
    expect(errs.duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// start_at
// ---------------------------------------------------------------------------

describe('sessionInputSchema — start_at', () => {
  it('accepts a valid ISO 8601 datetime', () => {
    const result = sessionInputSchema.safeParse(VALID_SESSION);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid datetime string', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, start_at: 'not-a-date' }),
    );
    expect(errs.start_at?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a date-only string (missing time)', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, start_at: '2026-06-15' }),
    );
    expect(errs.start_at?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// amount
// ---------------------------------------------------------------------------

describe('sessionInputSchema — amount', () => {
  it.each([['150'], ['250.00'], ['0.01'], ['1000']])(
    'accepts valid positive amount "%s"',
    (amount) => {
      const result = sessionInputSchema.safeParse({ ...VALID_SESSION, amount });
      expect(result.success).toBe(true);
    },
  );

  it.each([
    ['0', 'zero'],
    ['-50', 'negative'],
    ['abc', 'non-numeric'],
    ['', 'empty string'],
  ])('rejects invalid amount "%s" (%s)', (amount) => {
    const errs = fieldErrorsOf(sessionInputSchema.safeParse({ ...VALID_SESSION, amount }));
    expect(errs.amount?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts absent amount (optional)', () => {
    const result = sessionInputSchema.safeParse(VALID_SESSION);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// patient_id (UUID format)
// ---------------------------------------------------------------------------

describe('sessionInputSchema — patient_id format', () => {
  it('rejects malformed UUID', () => {
    const errs = fieldErrorsOf(
      sessionInputSchema.safeParse({ ...VALID_SESSION, patient_id: 'not-a-uuid' }),
    );
    expect(errs.patient_id?.length ?? 0).toBeGreaterThan(0);
  });
});
