import { describe, expect, it } from 'vitest';

import {
  createScaleApplicationSchema,
  submitResponsesByTokenSchema,
  submitResponsesSchema,
} from '@/modules/medical-records/lib/scales-schemas';

// ---------------------------------------------------------------------------
// createScaleApplicationSchema
// ---------------------------------------------------------------------------

describe('createScaleApplicationSchema', () => {
  const validInput = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    scaleKey: 'phq9' as const,
    mode: 'in-session' as const,
  };

  it('accepts a valid input with all required fields', () => {
    const result = createScaleApplicationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts remote mode', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      mode: 'remote',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional expiresInHours', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      expiresInHours: 48,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresInHours).toBe(48);
    }
  });

  it('accepts all valid scale keys', () => {
    const keys = ['phq9', 'gad7', 'sdq', 'audit', 'whoqol-bref'] as const;
    for (const scaleKey of keys) {
      const result = createScaleApplicationSchema.safeParse({
        ...validInput,
        scaleKey,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid scaleKey', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      scaleKey: 'invalid-scale',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing mode', () => {
    const { mode: _mode, ...noMode } = validInput;
    void _mode;
    const result = createScaleApplicationSchema.safeParse(noMode);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid mode value', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      mode: 'self-apply',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID patientId', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      patientId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative expiresInHours', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      expiresInHours: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer expiresInHours', () => {
    const result = createScaleApplicationSchema.safeParse({
      ...validInput,
      expiresInHours: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitResponsesSchema
// ---------------------------------------------------------------------------

describe('submitResponsesSchema', () => {
  const validInput = {
    applicationId: '550e8400-e29b-41d4-a716-446655440000',
    responses: { q1: 2, q2: 1, q3: 0 },
  };

  it('accepts valid input', () => {
    const result = submitResponsesSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts an empty responses record', () => {
    const result = submitResponsesSchema.safeParse({
      ...validInput,
      responses: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID applicationId', () => {
    const result = submitResponsesSchema.safeParse({
      ...validInput,
      applicationId: 'bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative response values', () => {
    const result = submitResponsesSchema.safeParse({
      ...validInput,
      responses: { q1: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer response values', () => {
    const result = submitResponsesSchema.safeParse({
      ...validInput,
      responses: { q1: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitResponsesByTokenSchema
// ---------------------------------------------------------------------------

describe('submitResponsesByTokenSchema', () => {
  const validToken = 'a'.repeat(64);
  const validInput = {
    token: validToken,
    responses: { q1: 3, q2: 0 },
  };

  it('accepts a valid 64-char hex token', () => {
    const result = submitResponsesByTokenSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rejects a token shorter than 64 characters', () => {
    const result = submitResponsesByTokenSchema.safeParse({
      ...validInput,
      token: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a token longer than 64 characters', () => {
    const result = submitResponsesByTokenSchema.safeParse({
      ...validInput,
      token: 'a'.repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative response values', () => {
    const result = submitResponsesByTokenSchema.safeParse({
      ...validInput,
      responses: { q1: -2 },
    });
    expect(result.success).toBe(false);
  });
});
