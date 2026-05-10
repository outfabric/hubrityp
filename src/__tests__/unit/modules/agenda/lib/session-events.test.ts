import { describe, expect, it } from 'vitest';

import {
  sessionCancelledEventSchema,
  sessionConfirmedEventSchema,
  sessionDoneEventSchema,
  sessionMissingNoteReminderEventSchema,
  sessionNoShowEventSchema,
  sessionRescheduledEventSchema,
} from '@/modules/agenda/lib/session-events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';
const VALID_DATE = '2026-06-15T14:00:00Z';

/** Build a payload with a specific key omitted. */
function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// ---------------------------------------------------------------------------
// sessionConfirmedEventSchema
// ---------------------------------------------------------------------------

describe('sessionConfirmedEventSchema', () => {
  const validPayload = {
    sessionId: VALID_UUID,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    confirmedAt: VALID_DATE,
    confirmedBy: 'patient' as const,
  };

  it('validates a correct payload', () => {
    const result = sessionConfirmedEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts confirmedBy = therapist', () => {
    const result = sessionConfirmedEventSchema.safeParse({
      ...validPayload,
      confirmedBy: 'therapist',
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload with missing sessionId', () => {
    const result = sessionConfirmedEventSchema.safeParse(omit(validPayload, 'sessionId'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with invalid confirmedBy', () => {
    const result = sessionConfirmedEventSchema.safeParse({
      ...validPayload,
      confirmedBy: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payload with non-UUID sessionId', () => {
    const result = sessionConfirmedEventSchema.safeParse({
      ...validPayload,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionCancelledEventSchema
// ---------------------------------------------------------------------------

describe('sessionCancelledEventSchema', () => {
  const validPayload = {
    sessionId: VALID_UUID,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    cancelledAt: VALID_DATE,
    cancelledBy: 'patient' as const,
    reason: 'Patient requested cancellation',
    notice: '24h+' as const,
    chargeApplied: false,
  };

  it('validates a correct payload', () => {
    const result = sessionCancelledEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts all notice tiers', () => {
    for (const notice of ['24h+', 'less_24h', 'less_1h', 'on_time'] as const) {
      const result = sessionCancelledEventSchema.safeParse({ ...validPayload, notice });
      expect(result.success).toBe(true);
    }
  });

  it('rejects payload with missing reason', () => {
    const result = sessionCancelledEventSchema.safeParse(omit(validPayload, 'reason'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with invalid notice tier', () => {
    const result = sessionCancelledEventSchema.safeParse({
      ...validPayload,
      notice: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payload with non-boolean chargeApplied', () => {
    const result = sessionCancelledEventSchema.safeParse({
      ...validPayload,
      chargeApplied: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionDoneEventSchema
// ---------------------------------------------------------------------------

describe('sessionDoneEventSchema', () => {
  const validPayload = {
    sessionId: VALID_UUID,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    doneAt: VALID_DATE,
  };

  it('validates a correct payload', () => {
    const result = sessionDoneEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects payload with missing doneAt', () => {
    const result = sessionDoneEventSchema.safeParse(omit(validPayload, 'doneAt'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with invalid userId', () => {
    const result = sessionDoneEventSchema.safeParse({
      ...validPayload,
      userId: 123,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionNoShowEventSchema
// ---------------------------------------------------------------------------

describe('sessionNoShowEventSchema', () => {
  const validPayload = {
    sessionId: VALID_UUID,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    noShowAt: VALID_DATE,
  };

  it('validates a correct payload', () => {
    const result = sessionNoShowEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects payload with missing patientId', () => {
    const result = sessionNoShowEventSchema.safeParse(omit(validPayload, 'patientId'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with non-date noShowAt', () => {
    const result = sessionNoShowEventSchema.safeParse({
      ...validPayload,
      noShowAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionRescheduledEventSchema
// ---------------------------------------------------------------------------

describe('sessionRescheduledEventSchema', () => {
  const validPayload = {
    oldSessionId: VALID_UUID,
    newSessionId: VALID_UUID_2,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    rescheduledAt: VALID_DATE,
  };

  it('validates a correct payload', () => {
    const result = sessionRescheduledEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects payload with missing newSessionId', () => {
    const result = sessionRescheduledEventSchema.safeParse(omit(validPayload, 'newSessionId'));
    expect(result.success).toBe(false);
  });

  it('rejects payload with invalid oldSessionId', () => {
    const result = sessionRescheduledEventSchema.safeParse({
      ...validPayload,
      oldSessionId: 'abc',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionMissingNoteReminderEventSchema
// ---------------------------------------------------------------------------

describe('sessionMissingNoteReminderEventSchema', () => {
  const validPayload = {
    sessionId: VALID_UUID,
    patientId: VALID_UUID,
    userId: VALID_UUID,
    doneAt: VALID_DATE,
    daysSinceDone: 3,
  };

  it('validates a correct payload', () => {
    const result = sessionMissingNoteReminderEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts daysSinceDone = 0', () => {
    const result = sessionMissingNoteReminderEventSchema.safeParse({
      ...validPayload,
      daysSinceDone: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload with missing daysSinceDone', () => {
    const result = sessionMissingNoteReminderEventSchema.safeParse(
      omit(validPayload, 'daysSinceDone'),
    );
    expect(result.success).toBe(false);
  });

  it('rejects payload with negative daysSinceDone', () => {
    const result = sessionMissingNoteReminderEventSchema.safeParse({
      ...validPayload,
      daysSinceDone: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects payload with non-integer daysSinceDone', () => {
    const result = sessionMissingNoteReminderEventSchema.safeParse({
      ...validPayload,
      daysSinceDone: 2.5,
    });
    expect(result.success).toBe(false);
  });
});
