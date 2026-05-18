import { describe, expect, it } from 'vitest';

import {
  getPersonalNotesInputSchema,
  personalNotesPasswordSchema,
  upsertPersonalNotesInputSchema,
} from '@/modules/medical-records/lib/personal-notes-schemas';

// ---------------------------------------------------------------------------
// personalNotesPasswordSchema
// ---------------------------------------------------------------------------

describe('personalNotesPasswordSchema', () => {
  it('accepts a 6-character password (minimum)', () => {
    expect(personalNotesPasswordSchema.safeParse('abcdef').success).toBe(true);
  });

  it('accepts a longer password', () => {
    expect(personalNotesPasswordSchema.safeParse('my-very-strong-password').success).toBe(true);
  });

  it('rejects a 5-character password', () => {
    const result = personalNotesPasswordSchema.safeParse('abcde');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(personalNotesPasswordSchema.safeParse('').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(personalNotesPasswordSchema.safeParse(123456).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertPersonalNotesInputSchema
// ---------------------------------------------------------------------------

describe('upsertPersonalNotesInputSchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts valid input with content', () => {
    const result = upsertPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
      content: '<p>Notas pessoais do paciente.</p>',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string content (clearing notes)', () => {
    const result = upsertPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
      content: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when patientId is not a valid UUID', () => {
    const result = upsertPersonalNotesInputSchema.safeParse({
      patientId: 'not-a-uuid',
      content: 'some content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when patientId is missing', () => {
    const result = upsertPersonalNotesInputSchema.safeParse({
      content: 'some content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when content is missing', () => {
    const result = upsertPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPersonalNotesInputSchema
// ---------------------------------------------------------------------------

describe('getPersonalNotesInputSchema', () => {
  const VALID_UUID = '660e8400-e29b-41d4-a716-446655440000';

  it('accepts input with patientId only (no password)', () => {
    const result = getPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('accepts input with patientId and password', () => {
    const result = getPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
      password: 'unlock-me',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when patientId is not a valid UUID', () => {
    const result = getPersonalNotesInputSchema.safeParse({
      patientId: 'bad-id',
    });
    expect(result.success).toBe(false);
  });

  it('accepts when password is explicitly undefined', () => {
    const result = getPersonalNotesInputSchema.safeParse({
      patientId: VALID_UUID,
      password: undefined,
    });
    expect(result.success).toBe(true);
  });
});
