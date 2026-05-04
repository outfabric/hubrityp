import { describe, expect, it } from 'vitest';

import { regionalCodeToUf, UF_SET, UFS, type UfCode } from '@/modules/registration/lib/uf-table';

/**
 * Canonical Brazilian UF codes from Apêndice A do PRD.
 *
 * Hard-coded here (not imported) so the test acts as an independent oracle:
 * if anyone adds/removes a UF in the source it must also be added/removed
 * here, and a typo in the source can never silently match a typo in the test.
 */
const CANONICAL_UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

describe('UFS', () => {
  it('contains exactly 27 Brazilian UFs', () => {
    expect(UFS).toHaveLength(27);
  });

  it('contains every canonical UF code', () => {
    for (const code of CANONICAL_UFS) {
      expect(UFS).toContain(code);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(UFS).size).toBe(UFS.length);
  });

  it('exposes a Set form (UF_SET) consistent with the array', () => {
    expect(UF_SET.size).toBe(UFS.length);
    for (const code of UFS) {
      expect(UF_SET.has(code)).toBe(true);
    }
  });

  it('does not include unknown / non-Brazilian codes', () => {
    expect(UF_SET.has('XX' as UfCode)).toBe(false);
    expect(UF_SET.has('US' as UfCode)).toBe(false);
    expect(UF_SET.has('' as UfCode)).toBe(false);
  });
});

describe('regionalCodeToUf', () => {
  it('contains every regional code from 01 to 24 (zero-padded)', () => {
    for (let i = 1; i <= 24; i += 1) {
      const code = String(i).padStart(2, '0');
      expect(regionalCodeToUf, `missing regional ${code}`).toHaveProperty(code);
    }
  });

  it('matches the canonical Apêndice A do PRD mapping', () => {
    expect(regionalCodeToUf).toEqual({
      '01': ['DF'],
      '02': ['PE'],
      '03': ['BA'],
      '04': ['MG'],
      '05': ['RJ'],
      '06': ['SP'],
      '07': ['RS'],
      '08': ['PR'],
      '09': ['GO'],
      '10': ['PA'],
      '11': ['CE'],
      '12': ['SC'],
      '13': ['PB'],
      '14': ['MS'],
      '15': ['AL'],
      '16': ['ES'],
      '17': ['RN'],
      '18': ['MT'],
      '19': ['SE'],
      '20': ['AM', 'RR', 'AC', 'RO'],
      '21': ['PI'],
      '22': ['MA'],
      '23': ['TO'],
      '24': ['AP'],
    });
  });

  it('every value is a non-empty list of valid UFs', () => {
    for (const [regional, ufs] of Object.entries(regionalCodeToUf)) {
      expect(Array.isArray(ufs), `regional ${regional} should map to an array`).toBe(true);
      expect(ufs.length, `regional ${regional} should map to >=1 UFs`).toBeGreaterThan(0);
      for (const uf of ufs) {
        expect(UF_SET.has(uf), `regional ${regional} → ${uf} must be a valid UF`).toBe(true);
      }
    }
  });

  it('has no UF appearing in more than one regional council, except the documented CRP-20 case', () => {
    const ufToRegionals = new Map<UfCode, string[]>();
    for (const [regional, ufs] of Object.entries(regionalCodeToUf)) {
      for (const uf of ufs) {
        const existing = ufToRegionals.get(uf) ?? [];
        existing.push(regional);
        ufToRegionals.set(uf, existing);
      }
    }
    for (const [uf, regionals] of ufToRegionals.entries()) {
      expect(regionals, `${uf} should belong to exactly one regional`).toHaveLength(1);
    }
  });

  it('covers every UF (every UfCode appears in at least one regional list)', () => {
    const covered = new Set<UfCode>();
    for (const ufs of Object.values(regionalCodeToUf)) {
      for (const uf of ufs) {
        covered.add(uf);
      }
    }
    for (const uf of UFS) {
      expect(covered.has(uf), `UF ${uf} is not covered by any regional`).toBe(true);
    }
  });

  it('models CRP-20 as a multi-UF council covering AM, RR, AC, RO', () => {
    expect(regionalCodeToUf['20']).toEqual(['AM', 'RR', 'AC', 'RO']);
  });
});
