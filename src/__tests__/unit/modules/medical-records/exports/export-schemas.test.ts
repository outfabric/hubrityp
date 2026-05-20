import { describe, expect, it } from 'vitest';

import {
  exportFiltersSchema,
  exportSectionsSchema,
} from '@/modules/medical-records/lib/exports/export-schemas';

// ---------------------------------------------------------------------------
// exportSectionsSchema
// ---------------------------------------------------------------------------

describe('exportSectionsSchema', () => {
  it('defaults every section to true when input is empty', () => {
    const result = exportSectionsSchema.parse({});

    expect(result).toEqual({
      anamnese: true,
      evolucoes: true,
      hipoteses: true,
      planoTerapeutico: true,
      escalas: true,
      documentos: true,
      anexosIndex: true,
    });
  });

  it('allows overriding individual sections while keeping other defaults', () => {
    const result = exportSectionsSchema.parse({ documentos: false });

    expect(result.documentos).toBe(false);
    expect(result.anamnese).toBe(true);
    expect(result.evolucoes).toBe(true);
    expect(result.hipoteses).toBe(true);
    expect(result.planoTerapeutico).toBe(true);
    expect(result.escalas).toBe(true);
    expect(result.anexosIndex).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exportFiltersSchema — defaults
// ---------------------------------------------------------------------------

describe('exportFiltersSchema', () => {
  describe('defaults', () => {
    it('defaults includePersonalNotes to false when input is empty', () => {
      const result = exportFiltersSchema.parse({});
      expect(result.includePersonalNotes).toBe(false);
    });

    it('defaults all sections to true when input is empty', () => {
      const result = exportFiltersSchema.parse({});

      expect(result.sections).toEqual({
        anamnese: true,
        evolucoes: true,
        hipoteses: true,
        planoTerapeutico: true,
        escalas: true,
        documentos: true,
        anexosIndex: true,
      });
    });

    it('defaults dateRange.from and dateRange.to to null when input is empty', () => {
      const result = exportFiltersSchema.parse({});
      expect(result.dateRange.from).toBeNull();
      expect(result.dateRange.to).toBeNull();
    });

    it('defaults deliveryEmail to undefined when not provided', () => {
      const result = exportFiltersSchema.parse({});
      expect(result.deliveryEmail).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Valid inputs
  // ---------------------------------------------------------------------------

  describe('valid inputs', () => {
    it('accepts a fully populated filters object', () => {
      const input = {
        dateRange: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-30T23:59:59.999Z',
        },
        sections: {
          anamnese: true,
          evolucoes: true,
          hipoteses: false,
          planoTerapeutico: true,
          escalas: false,
          documentos: true,
          anexosIndex: true,
        },
        includePersonalNotes: true,
        deliveryEmail: 'psi@example.com',
      };

      const result = exportFiltersSchema.parse(input);

      expect(result.dateRange.from).toBe('2026-01-01T00:00:00.000Z');
      expect(result.dateRange.to).toBe('2026-06-30T23:59:59.999Z');
      expect(result.sections.hipoteses).toBe(false);
      expect(result.sections.escalas).toBe(false);
      expect(result.includePersonalNotes).toBe(true);
      expect(result.deliveryEmail).toBe('psi@example.com');
    });

    it('accepts null values for dateRange fields', () => {
      const result = exportFiltersSchema.parse({
        dateRange: { from: null, to: null },
      });

      expect(result.dateRange.from).toBeNull();
      expect(result.dateRange.to).toBeNull();
    });

    it('accepts deliveryEmail as optional — missing is OK', () => {
      const result = exportFiltersSchema.parse({
        includePersonalNotes: false,
      });

      expect(result.deliveryEmail).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Partial sections merge
  // ---------------------------------------------------------------------------

  describe('sections partial input', () => {
    it('merges partial sections with defaults', () => {
      const result = exportFiltersSchema.parse({
        sections: { documentos: false },
      });

      expect(result.sections.documentos).toBe(false);
      expect(result.sections.anamnese).toBe(true);
      expect(result.sections.evolucoes).toBe(true);
      expect(result.sections.hipoteses).toBe(true);
      expect(result.sections.planoTerapeutico).toBe(true);
      expect(result.sections.escalas).toBe(true);
      expect(result.sections.anexosIndex).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid inputs
  // ---------------------------------------------------------------------------

  describe('invalid inputs', () => {
    it('rejects dateRange.from that is not an ISO datetime', () => {
      const result = exportFiltersSchema.safeParse({
        dateRange: { from: 'not-a-date', to: null },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('dateRange.from');
      }
    });

    it('rejects dateRange.to that is not an ISO datetime', () => {
      const result = exportFiltersSchema.safeParse({
        dateRange: { from: null, to: '2026-13-01' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('dateRange.to');
      }
    });

    it('rejects deliveryEmail that is not a valid email', () => {
      const result = exportFiltersSchema.safeParse({
        deliveryEmail: 'not-an-email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('deliveryEmail');
      }
    });
  });
});
