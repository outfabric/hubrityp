import { describe, expect, it } from 'vitest';

import {
  createHypothesisSchema,
  hypothesisStatusSchema,
  updateHypothesisSchema,
  updateHypothesisStatusSchema,
} from '@/modules/medical-records/lib/schemas/hypothesis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PATIENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_HYPOTHESIS_ID = '660e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// hypothesisStatusSchema
// ---------------------------------------------------------------------------

describe('hypothesisStatusSchema', () => {
  it.each(['investigating', 'confirmed', 'discarded'] as const)(
    'accepts valid status "%s"',
    (status) => {
      const result = hypothesisStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    },
  );

  it('rejects an invalid status value', () => {
    const result = hypothesisStatusSchema.safeParse('archived');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = hypothesisStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createHypothesisSchema
// ---------------------------------------------------------------------------

describe('createHypothesisSchema', () => {
  it('accepts with only description (no cid10Code)', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      description: 'Tracos de ansiedade social',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with only cid10Code (no description)', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      cid10Code: 'F32.0',
      cid10Description: 'Episodio depressivo leve',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with both description and cid10Code', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      description: 'Correlacao com estressores laborais',
      cid10Code: 'F41.1',
      cid10Description: 'Ansiedade generalizada',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when both description and cid10Code are absent', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when description is empty string and cid10Code is absent', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      description: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid patientId format (not a UUID)', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: 'not-a-uuid',
      description: 'Some hypothesis',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty string as patientId', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: '',
      description: 'Some hypothesis',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional notes field', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      description: 'Hypothesis with notes',
      notes: 'Additional context',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('Additional context');
    }
  });

  it('rejects cid10Code longer than 10 characters', () => {
    const result = createHypothesisSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      cid10Code: 'F32.0.12345',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateHypothesisSchema
// ---------------------------------------------------------------------------

describe('updateHypothesisSchema', () => {
  it('accepts when updating description only', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      description: 'Updated hypothesis text',
    });
    expect(result.success).toBe(true);
  });

  it('accepts when updating cid10Code only', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      cid10Code: 'F41.0',
    });
    expect(result.success).toBe(true);
  });

  it('accepts when neither description nor cid10Code is in the payload (no change to those fields)', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      notes: 'Just updating notes',
    });
    expect(result.success).toBe(true);
  });

  it('rejects clearing both description and cid10Code (both set to empty string)', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      description: '',
      cid10Code: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid hypothesisId format', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: 'bad-id',
      description: 'Valid description',
    });
    expect(result.success).toBe(false);
  });

  it('accepts clearing description when cid10Code has a value', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      description: '',
      cid10Code: 'F32.0',
    });
    expect(result.success).toBe(true);
  });

  it('accepts clearing cid10Code when description has a value', () => {
    const result = updateHypothesisSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      description: 'Still has a description',
      cid10Code: '',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateHypothesisStatusSchema
// ---------------------------------------------------------------------------

describe('updateHypothesisStatusSchema', () => {
  it('accepts valid status transition to confirmed', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      status: 'confirmed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid status transition to discarded with notes', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      status: 'discarded',
      notes: 'Hipotese descartada apos reavaliacao',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('Hipotese descartada apos reavaliacao');
    }
  });

  it('accepts valid status transition to discarded without notes', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      status: 'discarded',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status transition to investigating', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      status: 'investigating',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status value', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
      status: 'resolved',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing status field', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: VALID_HYPOTHESIS_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid hypothesisId', () => {
    const result = updateHypothesisStatusSchema.safeParse({
      hypothesisId: 'not-a-valid-uuid',
      status: 'confirmed',
    });
    expect(result.success).toBe(false);
  });
});
