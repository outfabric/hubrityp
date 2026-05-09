import { describe, expect, it } from 'vitest';

import { agendaSettingsInputSchema } from '@/modules/agenda/lib/agenda-settings-input-schema';

/**
 * Canonical valid payload — reused as a base; each test overrides exactly the
 * field under test.
 */
const VALID_PAYLOAD = {
  default_duration_minutes: 50,
  interval_minutes: 10,
  business_hours: [
    { day: 1, start: '08:00', end: '12:00' },
    { day: 1, start: '14:00', end: '18:00' },
  ],
};

type FieldErrorRecord = Record<string, string[] | undefined>;

const fieldErrorsOf = (
  result: ReturnType<typeof agendaSettingsInputSchema.safeParse>,
): FieldErrorRecord => {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error.flatten().fieldErrors;
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — happy path', () => {
  it('accepts the canonical valid payload', () => {
    const result = agendaSettingsInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts a full payload with all optional fields', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      cancellation_policy: 'Cancelamento com 24h de antecedência.',
      default_color: '#3B82F6',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// default_duration_minutes
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — default_duration_minutes', () => {
  it('rejects duration below 15 minutes', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, default_duration_minutes: 14 }),
    );
    expect(errs.default_duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects duration above 240 minutes', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, default_duration_minutes: 241 }),
    );
    expect(errs.default_duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts duration of exactly 15 minutes', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      default_duration_minutes: 15,
    });
    expect(result.success).toBe(true);
  });

  it('accepts duration of exactly 240 minutes', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      default_duration_minutes: 240,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer duration', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, default_duration_minutes: 50.5 }),
    );
    expect(errs.default_duration_minutes?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// interval_minutes
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — interval_minutes', () => {
  it('accepts interval of 0 (no gap between sessions)', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      interval_minutes: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts interval of exactly 60 minutes', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      interval_minutes: 60,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative interval', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, interval_minutes: -1 }),
    );
    expect(errs.interval_minutes?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects interval above 60', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, interval_minutes: 61 }),
    );
    expect(errs.interval_minutes?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// business_hours
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — business_hours', () => {
  it('accepts valid business hours (end > start)', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [{ day: 2, start: '09:00', end: '17:00' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects business hours where end <= start (same time)', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [{ day: 3, start: '10:00', end: '10:00' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects business hours where end < start', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [{ day: 4, start: '18:00', end: '08:00' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty array of business hours', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid day of week (7)', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [{ day: 7, start: '08:00', end: '12:00' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid time format', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [{ day: 1, start: '8:00', end: '12:00' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts day 0 (Sunday) and day 6 (Saturday)', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      business_hours: [
        { day: 0, start: '08:00', end: '12:00' },
        { day: 6, start: '08:00', end: '12:00' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cancellation_policy
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — cancellation_policy', () => {
  it('accepts absent cancellation_policy (optional)', () => {
    const result = agendaSettingsInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('rejects cancellation_policy longer than 2000 characters', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({
        ...VALID_PAYLOAD,
        cancellation_policy: 'A'.repeat(2001),
      }),
    );
    expect(errs.cancellation_policy?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// default_color
// ---------------------------------------------------------------------------

describe('agendaSettingsInputSchema — default_color', () => {
  it('accepts valid hex color', () => {
    const result = agendaSettingsInputSchema.safeParse({
      ...VALID_PAYLOAD,
      default_color: '#3B82F6',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid hex color', () => {
    const errs = fieldErrorsOf(
      agendaSettingsInputSchema.safeParse({ ...VALID_PAYLOAD, default_color: 'blue' }),
    );
    expect(errs.default_color?.length ?? 0).toBeGreaterThan(0);
  });
});
