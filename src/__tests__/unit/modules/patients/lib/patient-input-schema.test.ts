import { describe, expect, it } from 'vitest';

import {
  createPatientSchema,
  listPatientsQuerySchema,
  updatePatientSchema,
} from '@/modules/patients/lib/patient-input-schema';

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

/** Minimal valid payload for createPatientSchema (step 1 only). */
const VALID_CREATE = {
  fullName: 'João Silva',
  patientType: 'individual',
} as const;

// ---------------------------------------------------------------------------
// createPatientSchema
// ---------------------------------------------------------------------------

describe('createPatientSchema — happy path', () => {
  it('accepts a minimal valid payload (step 1 only: fullName + patientType)', () => {
    const result = createPatientSchema.safeParse(VALID_CREATE);
    expect(result.success).toBe(true);
  });

  it('accepts a full payload with all optional fields', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      birthDate: '1990-05-15',
      approximateAge: '33',
      gender: 'male',
      phone: '+55 11 91234-5678',
      email: 'joao@example.com',
      cpf: '529.982.247-25',
      address: {
        street: 'Rua das Flores',
        number: '123',
        complement: 'Apt 42',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01001-000',
      },
      profession: 'Engenheiro',
      maritalStatus: 'married',
      source: 'indication',
      tags: ['ansiedade', 'adulto'],
      notes: 'Primeira consulta agendada.',
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from fullName', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      fullName: '  João Silva  ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fullName).toBe('João Silva');
  });

  it('normalizes tags to lowercase', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      tags: ['Ansiedade', 'DEPRESSÃO', 'Tcc'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tags).toEqual(['ansiedade', 'depressão', 'tcc']);
  });

  it('accepts all valid patient types', () => {
    for (const type of ['individual', 'child', 'adolescent', 'couple', 'elderly']) {
      const result = createPatientSchema.safeParse({ ...VALID_CREATE, patientType: type });
      expect(result.success, `expected '${type}' to be valid`).toBe(true);
    }
  });

  it('accepts empty string for email (optional field)', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      email: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for phone (optional, passes validation for empty)', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      phone: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for cpf (optional, passes validation for empty)', () => {
    const result = createPatientSchema.safeParse({
      ...VALID_CREATE,
      cpf: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('createPatientSchema — required fields', () => {
  it('rejects missing fullName', () => {
    const errs = fieldErrorsOf(createPatientSchema.safeParse({ patientType: 'individual' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects missing patientType', () => {
    const errs = fieldErrorsOf(createPatientSchema.safeParse({ fullName: 'João' }));
    expect(errs.patientType?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects empty fullName', () => {
    const errs = fieldErrorsOf(createPatientSchema.safeParse({ ...VALID_CREATE, fullName: '' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects fullName shorter than 2 characters', () => {
    const errs = fieldErrorsOf(createPatientSchema.safeParse({ ...VALID_CREATE, fullName: 'A' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects fullName longer than 200 characters', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, fullName: 'A'.repeat(201) }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('createPatientSchema — invalid formats', () => {
  it('rejects invalid patientType', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, patientType: 'alien' }),
    );
    expect(errs.patientType?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid phone format', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, phone: '11912345678' }),
    );
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid email', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, email: 'not-an-email' }),
    );
    expect(errs.email?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid CPF (all same digits)', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, cpf: '111.111.111-11' }),
    );
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid CPF (bad check digits)', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, cpf: '529.982.247-00' }),
    );
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid gender enum value', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, gender: 'unknown' }),
    );
    expect(errs.gender?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid maritalStatus enum value', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, maritalStatus: 'complicated' }),
    );
    expect(errs.maritalStatus?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid source enum value', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, source: 'telepathy' }),
    );
    expect(errs.source?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects more than 30 tags', () => {
    const tooManyTags = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, tags: tooManyTags }),
    );
    expect(errs.tags?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects notes longer than 5000 characters', () => {
    const errs = fieldErrorsOf(
      createPatientSchema.safeParse({ ...VALID_CREATE, notes: 'x'.repeat(5001) }),
    );
    expect(errs.notes?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// updatePatientSchema
// ---------------------------------------------------------------------------

describe('updatePatientSchema — partiality', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = updatePatientSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts only fullName (partial update)', () => {
    const result = updatePatientSchema.safeParse({ fullName: 'Maria Santos' });
    expect(result.success).toBe(true);
  });

  it('accepts only status change', () => {
    const result = updatePatientSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status value', () => {
    const errs = fieldErrorsOf(updatePatientSchema.safeParse({ status: 'deleted' }));
    expect(errs.status?.length ?? 0).toBeGreaterThan(0);
  });

  it('still validates individual field formats when provided', () => {
    const errs = fieldErrorsOf(updatePatientSchema.safeParse({ phone: 'not-a-phone' }));
    expect(errs.phone?.length ?? 0).toBeGreaterThan(0);
  });

  it('still validates CPF when provided', () => {
    const errs = fieldErrorsOf(updatePatientSchema.safeParse({ cpf: '000.000.000-00' }));
    expect(errs.cpf?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// listPatientsQuerySchema
// ---------------------------------------------------------------------------

describe('listPatientsQuerySchema — defaults', () => {
  it('applies default page=1, pageSize=25, sort=full_name, order=asc on empty input', () => {
    const result = listPatientsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(25);
    expect(result.data.sort).toBe('full_name');
    expect(result.data.order).toBe('asc');
  });

  it('uses provided values over defaults', () => {
    const result = listPatientsQuerySchema.safeParse({
      page: 3,
      pageSize: 50,
      sort: 'created_at',
      order: 'desc',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(3);
    expect(result.data.pageSize).toBe(50);
    expect(result.data.sort).toBe('created_at');
    expect(result.data.order).toBe('desc');
  });
});

describe('listPatientsQuerySchema — validation', () => {
  it('rejects page < 1', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ page: 0 }));
    expect(errs.page?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects negative page', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ page: -1 }));
    expect(errs.page?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects non-integer page', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ page: 1.5 }));
    expect(errs.page?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects pageSize > 100', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ pageSize: 101 }));
    expect(errs.pageSize?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects pageSize < 1', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ pageSize: 0 }));
    expect(errs.pageSize?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid sort column', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ sort: 'invalid_col' }));
    expect(errs.sort?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts all valid sort columns', () => {
    for (const col of ['full_name', 'created_at', 'updated_at']) {
      const result = listPatientsQuerySchema.safeParse({ sort: col });
      expect(result.success, `expected sort='${col}' to be valid`).toBe(true);
    }
  });

  it('rejects invalid order value', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ order: 'random' }));
    expect(errs.order?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects invalid status filter', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ status: 'deleted' }));
    expect(errs.status?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts status filter "active"', () => {
    const result = listPatientsQuerySchema.safeParse({ status: 'active' });
    expect(result.success).toBe(true);
  });

  it('accepts status filter "archived"', () => {
    const result = listPatientsQuerySchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(true);
  });

  it('coerces string page to number', () => {
    const result = listPatientsQuerySchema.safeParse({ page: '2' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(2);
  });

  it('accepts tags as comma-separated string', () => {
    const result = listPatientsQuerySchema.safeParse({ tags: 'ansiedade,depressão' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tags).toEqual(['ansiedade', 'depressão']);
  });

  it('accepts tags as array of strings', () => {
    const result = listPatientsQuerySchema.safeParse({ tags: ['ansiedade', 'depressão'] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tags).toEqual(['ansiedade', 'depressão']);
  });

  it('accepts search string', () => {
    const result = listPatientsQuerySchema.safeParse({ search: 'João' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.search).toBe('João');
  });

  it('rejects search longer than 200 characters', () => {
    const errs = fieldErrorsOf(listPatientsQuerySchema.safeParse({ search: 'x'.repeat(201) }));
    expect(errs.search?.length ?? 0).toBeGreaterThan(0);
  });
});
