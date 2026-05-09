import { describe, expect, it } from 'vitest';

import { validateCsvRow } from '@/modules/patients/lib/validate-csv-row';
import type { MappedCsvRow } from '@/modules/patients/lib/validate-csv-row';

// ---------------------------------------------------------------------------
// Helper — builds a valid row as baseline, then overrides for each case
// ---------------------------------------------------------------------------

function validRow(overrides: Partial<MappedCsvRow> = {}): MappedCsvRow {
  return {
    full_name: 'Maria Silva',
    phone: '+55 11 91234-5678',
    email: 'maria@example.com',
    birth_date: '15/03/1990',
    tags: 'ansiedade, adulto',
    notes: 'Primeira consulta via indicação.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Full valid row
// ---------------------------------------------------------------------------

describe('validateCsvRow', () => {
  it('accepts a fully valid row', () => {
    const result = validateCsvRow(validRow());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts a minimal row with only full_name', () => {
    const result = validateCsvRow({ full_name: 'João' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // full_name validation
  // -------------------------------------------------------------------------

  describe('full_name', () => {
    it('rejects missing full_name', () => {
      const result = validateCsvRow(validRow({ full_name: undefined }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Nome é obrigatório.');
    });

    it('rejects empty string full_name', () => {
      const result = validateCsvRow(validRow({ full_name: '' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Nome é obrigatório.');
    });

    it('rejects whitespace-only full_name', () => {
      const result = validateCsvRow(validRow({ full_name: '   ' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Nome é obrigatório.');
    });

    it('rejects single character full_name', () => {
      const result = validateCsvRow(validRow({ full_name: 'A' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('O nome deve ter pelo menos 2 caracteres.');
    });

    it('accepts 2-character full_name', () => {
      const result = validateCsvRow(validRow({ full_name: 'Li' }));

      expect(result.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // phone validation
  // -------------------------------------------------------------------------

  describe('phone', () => {
    it('accepts canonical format: +55 11 91234-5678', () => {
      const result = validateCsvRow(validRow({ phone: '+55 11 91234-5678' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts 11-digit phone (auto-formatted): 11912345678', () => {
      const result = validateCsvRow(validRow({ phone: '11912345678' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts 13-digit phone with country code: 5511912345678', () => {
      const result = validateCsvRow(validRow({ phone: '5511912345678' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts phone with parentheses: (11) 91234-5678', () => {
      const result = validateCsvRow(validRow({ phone: '(11) 91234-5678' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects clearly invalid phone: 123456', () => {
      const result = validateCsvRow(validRow({ phone: '123456' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Telefone inválido.');
    });

    it('rejects phone with letters', () => {
      const result = validateCsvRow(validRow({ phone: 'abc123' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Telefone inválido.');
    });

    it('rejects landline number (8 digits, not starting with 9)', () => {
      const result = validateCsvRow(validRow({ phone: '+55 11 3234-5678' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Telefone inválido.');
    });

    it('accepts empty phone (field is optional)', () => {
      const result = validateCsvRow(validRow({ phone: '' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts undefined phone (field is optional)', () => {
      const result = validateCsvRow(validRow({ phone: undefined }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // email validation
  // -------------------------------------------------------------------------

  describe('email', () => {
    it('accepts valid email: user@example.com', () => {
      const result = validateCsvRow(validRow({ email: 'user@example.com' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts email with subdomain: user@mail.example.com', () => {
      const result = validateCsvRow(validRow({ email: 'user@mail.example.com' }));

      expect(result.valid).toBe(true);
    });

    it('accepts email with plus addressing: user+tag@example.com', () => {
      const result = validateCsvRow(validRow({ email: 'user+tag@example.com' }));

      expect(result.valid).toBe(true);
    });

    it('rejects email without @', () => {
      const result = validateCsvRow(validRow({ email: 'userexample.com' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('E-mail inválido.');
    });

    it('rejects email without domain', () => {
      const result = validateCsvRow(validRow({ email: 'user@' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('E-mail inválido.');
    });

    it('rejects email without TLD', () => {
      const result = validateCsvRow(validRow({ email: 'user@example' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('E-mail inválido.');
    });

    it('rejects email with spaces', () => {
      const result = validateCsvRow(validRow({ email: 'user @example.com' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('E-mail inválido.');
    });

    it('accepts empty email (field is optional)', () => {
      const result = validateCsvRow(validRow({ email: '' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts undefined email (field is optional)', () => {
      const result = validateCsvRow(validRow({ email: undefined }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // birth_date validation
  // -------------------------------------------------------------------------

  describe('birth_date', () => {
    it('accepts DD/MM/YYYY format: 15/03/1990', () => {
      const result = validateCsvRow(validRow({ birth_date: '15/03/1990' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts YYYY-MM-DD (ISO) format: 1990-03-15', () => {
      const result = validateCsvRow(validRow({ birth_date: '1990-03-15' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts leap year date: 29/02/2000', () => {
      const result = validateCsvRow(validRow({ birth_date: '29/02/2000' }));

      expect(result.valid).toBe(true);
    });

    it('rejects invalid calendar date: 31/02/1990', () => {
      const result = validateCsvRow(validRow({ birth_date: '31/02/1990' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });

    it('rejects non-leap year Feb 29: 29/02/2001', () => {
      const result = validateCsvRow(validRow({ birth_date: '29/02/2001' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });

    it('rejects unrecognized date format: 03-15-1990', () => {
      const result = validateCsvRow(validRow({ birth_date: '03-15-1990' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });

    it('rejects text as date: "ontem"', () => {
      const result = validateCsvRow(validRow({ birth_date: 'ontem' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });

    it('rejects partial date: 15/03', () => {
      const result = validateCsvRow(validRow({ birth_date: '15/03' }));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });

    it('accepts empty birth_date (field is optional)', () => {
      const result = validateCsvRow(validRow({ birth_date: '' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts undefined birth_date (field is optional)', () => {
      const result = validateCsvRow(validRow({ birth_date: undefined }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // tags & notes — no validation errors expected
  // -------------------------------------------------------------------------

  describe('tags and notes', () => {
    it('accepts any tags value without error', () => {
      const result = validateCsvRow(validRow({ tags: 'ansiedade, depressão, TCC' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts any notes value without error', () => {
      const result = validateCsvRow(validRow({ notes: 'Longa observação com acentos: àéîõü' }));

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple errors
  // -------------------------------------------------------------------------

  describe('multiple errors', () => {
    it('collects errors from multiple invalid fields', () => {
      const result = validateCsvRow({
        full_name: '',
        phone: '123',
        email: 'not-an-email',
        birth_date: 'invalid',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors).toContain('Nome é obrigatório.');
      expect(result.errors).toContain('Telefone inválido.');
      expect(result.errors).toContain('E-mail inválido.');
      expect(result.errors).toContain('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    });
  });
});
