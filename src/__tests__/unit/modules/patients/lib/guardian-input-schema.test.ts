import { describe, expect, it } from 'vitest';

import {
  createGuardianSchema,
  updateGuardianSchema,
} from '@/modules/patients/lib/guardian-input-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FieldErrorRecord = Record<string, string[] | undefined>;

function fieldErrorsOf(result: {
  success: boolean;
  error?: { flatten(): { fieldErrors: FieldErrorRecord } };
}): FieldErrorRecord {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error!.flatten().fieldErrors;
}

/** Minimal valid payload for createGuardianSchema. */
const VALID_GUARDIAN = {
  fullName: 'Maria Silva',
  relationship: 'Mãe',
  phone: '+55 11 91234-5678',
} as const;

// ---------------------------------------------------------------------------
// createGuardianSchema — happy path
// ---------------------------------------------------------------------------

describe('createGuardianSchema — happy path', () => {
  it('accepts a minimal valid payload (fullName + relationship + phone)', () => {
    const result = createGuardianSchema.safeParse(VALID_GUARDIAN);
    expect(result.success).toBe(true);
  });

  it('accepts a full payload with all optional fields', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      cpf: '529.982.247-25',
      email: 'maria@example.com',
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from fullName', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      fullName: '  Maria Silva  ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fullName).toBe('Maria Silva');
  });

  it('trims whitespace from relationship', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      relationship: '  Mãe  ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.relationship).toBe('Mãe');
  });

  it('defaults isPrimary to false when omitted', () => {
    const result = createGuardianSchema.safeParse(VALID_GUARDIAN);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isPrimary).toBe(false);
  });

  it('accepts valid CPF when provided', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      cpf: '529.982.247-25',
    });
    expect(result.success).toBe(true);
  });

  it('accepts unformatted valid CPF', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      cpf: '52998224725',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for cpf (optional, passes validation for empty)', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      cpf: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid email when provided', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      email: 'maria@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for email (optional field)', () => {
    const result = createGuardianSchema.safeParse({
      ...VALID_GUARDIAN,
      email: '',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createGuardianSchema — required fields
// ---------------------------------------------------------------------------

describe('createGuardianSchema — required fields', () => {
  it('rejects missing fullName', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ relationship: 'Mãe', phone: '+55 11 91234-5678' }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects missing relationship', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ fullName: 'Maria Silva', phone: '+55 11 91234-5678' }),
    );
    expect(errs.relationship?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects missing phone', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ fullName: 'Maria Silva', relationship: 'Mãe' }),
    );
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects empty fullName', () => {
    const errs = fieldErrorsOf(createGuardianSchema.safeParse({ ...VALID_GUARDIAN, fullName: '' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects fullName shorter than 2 characters', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, fullName: 'A' }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects fullName longer than 200 characters', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, fullName: 'A'.repeat(201) }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects empty relationship', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, relationship: '' }),
    );
    expect(errs.relationship?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects relationship shorter than 2 characters', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, relationship: 'X' }),
    );
    expect(errs.relationship?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createGuardianSchema — invalid formats
// ---------------------------------------------------------------------------

describe('createGuardianSchema — invalid formats', () => {
  it('rejects invalid phone format (missing country code)', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, phone: '11912345678' }),
    );
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid phone format (landline)', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, phone: '+55 11 3456-7890' }),
    );
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid CPF (all same digits)', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, cpf: '111.111.111-11' }),
    );
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid CPF (bad check digits)', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, cpf: '529.982.247-00' }),
    );
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid email', () => {
    const errs = fieldErrorsOf(
      createGuardianSchema.safeParse({ ...VALID_GUARDIAN, email: 'not-an-email' }),
    );
    expect(errs.email?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// updateGuardianSchema
// ---------------------------------------------------------------------------

describe('updateGuardianSchema — partiality', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = updateGuardianSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts only fullName (partial update)', () => {
    const result = updateGuardianSchema.safeParse({ fullName: 'João Santos' });
    expect(result.success).toBe(true);
  });

  it('accepts only relationship (partial update)', () => {
    const result = updateGuardianSchema.safeParse({ relationship: 'Pai' });
    expect(result.success).toBe(true);
  });

  it('accepts only phone (partial update)', () => {
    const result = updateGuardianSchema.safeParse({ phone: '+55 21 99876-5432' });
    expect(result.success).toBe(true);
  });

  it('accepts only isPrimary (partial update)', () => {
    const result = updateGuardianSchema.safeParse({ isPrimary: true });
    expect(result.success).toBe(true);
  });

  it('still validates phone format when provided', () => {
    const errs = fieldErrorsOf(updateGuardianSchema.safeParse({ phone: 'not-a-phone' }));
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('still validates CPF when provided', () => {
    const errs = fieldErrorsOf(updateGuardianSchema.safeParse({ cpf: '000.000.000-00' }));
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });

  it('still validates email when provided', () => {
    const errs = fieldErrorsOf(updateGuardianSchema.safeParse({ email: 'bad-email' }));
    expect(errs.email?.length ?? 0).toBeGreaterThan(0);
  });

  it('still validates fullName min length when provided', () => {
    const errs = fieldErrorsOf(updateGuardianSchema.safeParse({ fullName: 'A' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });
});
