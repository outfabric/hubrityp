import { describe, expect, it } from 'vitest';

import { crpNumberSchema, crpUfSchema } from '@/modules/crp-validation/lib/crp-format';

// Spec scenarios for `crpNumberSchema`. Each `it` corresponds to a scenario
// listed in `openspec/changes/add-account-signup-and-lifecycle/specs/
// crp-validation/spec.md` (Requirement: "CRP number format is validated
// synchronously at the form boundary").

describe('crpNumberSchema', () => {
  describe('valid inputs', () => {
    it('accepts a well-formed CRP (06/123456) — spec scenario "Valid CRP passes the format check"', () => {
      const result = crpNumberSchema.safeParse('06/123456');
      expect(result.success).toBe(true);
    });

    it('accepts the minimum inscription length (4 digits)', () => {
      const result = crpNumberSchema.safeParse('06/1234');
      expect(result.success).toBe(true);
    });

    it('accepts the maximum inscription length (7 digits)', () => {
      const result = crpNumberSchema.safeParse('06/1234567');
      expect(result.success).toBe(true);
    });

    it('accepts every PRD-01 regional code with a 6-digit inscription', () => {
      // Each known regional code must pass the schema. Failure here means
      // either the regex changed or the regional-codes constant drifted.
      for (const code of [
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
        '16',
        '17',
        '18',
        '19',
        '20',
        '21',
        '22',
        '23',
        '24',
      ]) {
        expect(crpNumberSchema.safeParse(`${code}/123456`).success).toBe(true);
      }
    });
  });

  describe('format failures', () => {
    it('rejects wrong delimiter (06-123456) with format-related message — spec scenario "Wrong delimiter is rejected"', () => {
      const result = crpNumberSchema.safeParse('06-123456');
      expect(result.success).toBe(false);
      if (!result.success) {
        // The format check fails first — the regional-code refinement only
        // runs after the regex passes — so the surfaced message MUST be the
        // format-oriented one. Asserting on the message keeps the spec
        // distinction "format" vs "regional code unknown" load-bearing.
        expect(result.error.issues[0]?.message).toMatch(/formato/i);
      }
    });

    it('rejects inscription too short (06/123) — spec scenario', () => {
      const result = crpNumberSchema.safeParse('06/123');
      expect(result.success).toBe(false);
    });

    it('rejects inscription too long (06/12345678) — spec scenario', () => {
      const result = crpNumberSchema.safeParse('06/12345678');
      expect(result.success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(crpNumberSchema.safeParse('').success).toBe(false);
    });

    it('rejects letters in inscription part', () => {
      expect(crpNumberSchema.safeParse('06/12A456').success).toBe(false);
    });

    it('rejects letters in regional prefix', () => {
      expect(crpNumberSchema.safeParse('SP/123456').success).toBe(false);
    });

    it('rejects leading/trailing whitespace', () => {
      expect(crpNumberSchema.safeParse(' 06/123456').success).toBe(false);
      expect(crpNumberSchema.safeParse('06/123456 ').success).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(crpNumberSchema.safeParse(123456).success).toBe(false);
      expect(crpNumberSchema.safeParse(null).success).toBe(false);
      expect(crpNumberSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe('regional code refinement', () => {
    it('rejects out-of-range regional code (99/123456) with regional-code message — spec scenario "Out-of-range regional code is rejected"', () => {
      const result = crpNumberSchema.safeParse('99/123456');
      expect(result.success).toBe(false);
      if (!result.success) {
        // Distinct from the format failure: the regex passes, but the
        // refinement reports an unknown regional code. The spec demands
        // separate signals for the two cases (the form layer presents
        // different help text).
        expect(result.error.issues[0]?.message).toMatch(/regional/i);
      }
    });

    it('rejects regional code 00 (not in PRD-01)', () => {
      expect(crpNumberSchema.safeParse('00/123456').success).toBe(false);
    });

    it('rejects regional code 25 (above PRD-01 range)', () => {
      expect(crpNumberSchema.safeParse('25/123456').success).toBe(false);
    });
  });
});

// Spec scenarios for `crpUfSchema` (Requirement: "CRP UF must be one of the
// 27 Brazilian UFs").

describe('crpUfSchema', () => {
  it('accepts a valid UF (SP) — spec scenario "Valid UF passes"', () => {
    const result = crpUfSchema.safeParse('SP');
    expect(result.success).toBe(true);
  });

  it('rejects lower-case (sp) — spec scenario "Lower-case UF is rejected"', () => {
    // The form Client Component is responsible for upper-casing before
    // submit. The schema is intentionally case-sensitive so the contract is
    // enforced consistently on every entry point.
    const result = crpUfSchema.safeParse('sp');
    expect(result.success).toBe(false);
  });

  it('rejects mixed case (Sp)', () => {
    expect(crpUfSchema.safeParse('Sp').success).toBe(false);
  });

  it('rejects non-UF string (XX) — spec scenario "Non-UF string is rejected"', () => {
    const result = crpUfSchema.safeParse('XX');
    expect(result.success).toBe(false);
  });

  it('accepts every Brazilian UF', () => {
    for (const uf of [
      'AC',
      'AL',
      'AM',
      'AP',
      'BA',
      'CE',
      'DF',
      'ES',
      'GO',
      'MA',
      'MG',
      'MS',
      'MT',
      'PA',
      'PB',
      'PE',
      'PI',
      'PR',
      'RJ',
      'RN',
      'RO',
      'RR',
      'RS',
      'SC',
      'SE',
      'SP',
      'TO',
    ]) {
      expect(crpUfSchema.safeParse(uf).success).toBe(true);
    }
  });

  it('rejects empty string and non-string input', () => {
    expect(crpUfSchema.safeParse('').success).toBe(false);
    expect(crpUfSchema.safeParse(null).success).toBe(false);
    expect(crpUfSchema.safeParse(123).success).toBe(false);
  });

  it('rejects values surrounded by whitespace', () => {
    expect(crpUfSchema.safeParse(' SP').success).toBe(false);
    expect(crpUfSchema.safeParse('SP ').success).toBe(false);
  });
});
