import { describe, expect, it } from 'vitest';

import {
  coupleSessionSchema,
  lateRecordSchema,
  recurrenceFormSchema,
} from '@/modules/sessions/lib/recurrence-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID_1 = '11111111-1111-4111-a111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-a222-222222222222';
const VALID_UUID_3 = '33333333-3333-4333-a333-333333333333';

const FUTURE_ISO = '2099-06-15T14:00:00.000Z';
const PAST_ISO = '2020-01-01T10:00:00.000Z';

// ---------------------------------------------------------------------------
// recurrenceFormSchema
// ---------------------------------------------------------------------------

describe('recurrenceFormSchema', () => {
  it('valid weekly schema passes', () => {
    const input = {
      frequency: 'weekly',
      daysOfWeek: [2], // Tuesday
      startDate: '2026-01-06T00:00:00.000Z',
      endDate: '2026-07-06T00:00:00.000Z',
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('valid weekly with occurrenceCount passes', () => {
    const input = {
      frequency: 'weekly',
      daysOfWeek: [2],
      startDate: '2026-01-06T00:00:00.000Z',
      occurrenceCount: 10,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('valid indefinite schema passes', () => {
    const input = {
      frequency: 'monthly',
      startDate: '2026-01-06T00:00:00.000Z',
      isIndefinite: true,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('missing frequency fails', () => {
    const input = {
      daysOfWeek: [2],
      startDate: '2026-01-06T00:00:00.000Z',
      endDate: '2026-07-06T00:00:00.000Z',
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('missing end condition (none of endDate/occurrenceCount/isIndefinite) fails', () => {
    const input = {
      frequency: 'weekly',
      daysOfWeek: [2],
      startDate: '2026-01-06T00:00:00.000Z',
      // no endDate, no occurrenceCount, no isIndefinite
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);

    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Informe uma condicao de termino: data final, numero de sessoes, ou marque como indefinido.',
      );
    }
  });

  it('occurrenceCount < 2 fails', () => {
    const input = {
      frequency: 'weekly',
      daysOfWeek: [2],
      startDate: '2026-01-06T00:00:00.000Z',
      occurrenceCount: 1,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('occurrenceCount > 104 fails', () => {
    const input = {
      frequency: 'weekly',
      daysOfWeek: [2],
      startDate: '2026-01-06T00:00:00.000Z',
      occurrenceCount: 105,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('daysOfWeek required for weekly frequency', () => {
    const input = {
      frequency: 'weekly',
      // daysOfWeek omitted
      startDate: '2026-01-06T00:00:00.000Z',
      endDate: '2026-07-06T00:00:00.000Z',
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);

    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('daysOfWeek');
    }
  });

  it('daysOfWeek required for custom frequency', () => {
    const input = {
      frequency: 'custom',
      startDate: '2026-01-06T00:00:00.000Z',
      endDate: '2026-07-06T00:00:00.000Z',
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(false);

    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('daysOfWeek');
    }
  });

  it('daysOfWeek NOT required for monthly frequency', () => {
    const input = {
      frequency: 'monthly',
      startDate: '2026-01-06T00:00:00.000Z',
      occurrenceCount: 6,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('daysOfWeek NOT required for biweekly frequency', () => {
    const input = {
      frequency: 'biweekly',
      startDate: '2026-01-06T00:00:00.000Z',
      occurrenceCount: 6,
    };

    const result = recurrenceFormSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coupleSessionSchema
// ---------------------------------------------------------------------------

describe('coupleSessionSchema', () => {
  it('valid couple with 2 distinct patient_ids passes', () => {
    const result = coupleSessionSchema.safeParse({
      patient_ids: [VALID_UUID_1, VALID_UUID_2],
    });
    expect(result.success).toBe(true);
  });

  it('single patient_id passes (partial couple, one selected so far)', () => {
    const result = coupleSessionSchema.safeParse({
      patient_ids: [VALID_UUID_1],
    });
    expect(result.success).toBe(true);
  });

  it('rejects >2 patient_ids', () => {
    const result = coupleSessionSchema.safeParse({
      patient_ids: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate patient_ids', () => {
    const result = coupleSessionSchema.safeParse({
      patient_ids: [VALID_UUID_1, VALID_UUID_1],
    });
    expect(result.success).toBe(false);

    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Selecione pacientes diferentes.');
    }
  });

  it('rejects invalid UUID format', () => {
    const result = coupleSessionSchema.safeParse({
      patient_ids: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lateRecordSchema
// ---------------------------------------------------------------------------

describe('lateRecordSchema', () => {
  it('valid late record with past date passes', () => {
    const result = lateRecordSchema.safeParse({
      is_late_record: true,
      date: PAST_ISO,
    });
    expect(result.success).toBe(true);
  });

  it('non-late record with future date passes', () => {
    const result = lateRecordSchema.safeParse({
      is_late_record: false,
      date: FUTURE_ISO,
    });
    expect(result.success).toBe(true);
  });

  it('late record requires past date when is_late_record=true', () => {
    const result = lateRecordSchema.safeParse({
      is_late_record: true,
      date: FUTURE_ISO,
    });
    expect(result.success).toBe(false);

    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Lancamentos retroativos devem ter uma data no passado.');
    }
  });

  it('non-late record with past date passes (normal session in past without flag)', () => {
    const result = lateRecordSchema.safeParse({
      is_late_record: false,
      date: PAST_ISO,
    });
    expect(result.success).toBe(true);
  });
});
