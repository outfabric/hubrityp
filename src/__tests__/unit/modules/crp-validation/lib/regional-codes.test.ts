import { describe, expect, it } from 'vitest';

import {
  type RegionalCode,
  BRAZILIAN_UFS,
  regionalCodes,
  regionalCodeToUf,
} from '@/modules/crp-validation/lib/regional-codes';

// Spec invariant ("Constant covers all PRD-01 codes"): every regional code
// from 01 through 24 has exactly one mapped UF, and the mapping matches
// PRD 01 Apêndice A verbatim. Listing each `(code, uf)` pair explicitly
// (rather than generating them from `regionalCodes` itself) means a wrong
// edit to the constant fails this test instead of silently passing — the
// expected values are the spec, not the code under test.

const PRD_01_MAPPING: ReadonlyArray<readonly [RegionalCode, string]> = [
  ['01', 'DF'],
  ['02', 'RJ'],
  ['03', 'MG'],
  ['04', 'RS'],
  ['05', 'BA'],
  ['06', 'SP'],
  ['07', 'PE'],
  ['08', 'PR'],
  ['09', 'SC'],
  ['10', 'CE'],
  ['11', 'ES'],
  ['12', 'PB'],
  ['13', 'AM'],
  ['14', 'PA'],
  ['15', 'GO'],
  ['16', 'MA'],
  ['17', 'MS'],
  ['18', 'MT'],
  ['19', 'RN'],
  ['20', 'AL'],
  ['21', 'PI'],
  ['22', 'SE'],
  ['23', 'AC'],
  ['24', 'RO'],
];

describe('regionalCodeToUf', () => {
  it.each(PRD_01_MAPPING)('maps regional code %s to UF %s', (code, expected) => {
    expect(regionalCodeToUf(code)).toBe(expected);
  });

  it('returns null for unknown regional code 99 (spec scenario)', () => {
    expect(regionalCodeToUf('99')).toBeNull();
  });

  it('returns null for non-2-digit input', () => {
    expect(regionalCodeToUf('006')).toBeNull();
    expect(regionalCodeToUf('6')).toBeNull();
    expect(regionalCodeToUf('')).toBeNull();
  });

  it('does not match inherited Object.prototype properties', () => {
    // Defensive: a naïve `code in regionalCodes` would return true for
    // `'toString'`, `'hasOwnProperty'`, etc. The implementation MUST guard
    // against that so a malicious form payload can't slip past validation.
    expect(regionalCodeToUf('toString')).toBeNull();
    expect(regionalCodeToUf('hasOwnProperty')).toBeNull();
    expect(regionalCodeToUf('__proto__')).toBeNull();
  });
});

describe('regionalCodes constant', () => {
  it('has exactly 24 entries (PRD 01 Apêndice A enumerates 01..24)', () => {
    expect(Object.keys(regionalCodes)).toHaveLength(24);
  });

  it('keys are zero-padded 2-digit strings', () => {
    for (const key of Object.keys(regionalCodes)) {
      expect(key).toMatch(/^\d{2}$/);
    }
  });

  it('values are valid 2-letter Brazilian UFs', () => {
    for (const value of Object.values(regionalCodes)) {
      expect(BRAZILIAN_UFS).toContain(value);
    }
  });
});

describe('BRAZILIAN_UFS constant', () => {
  it('contains all 27 Brazilian UFs', () => {
    expect(BRAZILIAN_UFS).toHaveLength(27);
  });

  it('contains the UFs without a regional CRP code (RR, AP, TO)', () => {
    // PRD 01 Apêndice A intentionally omits these — they are served by
    // neighboring CRPs — but the UF enum still covers them because a
    // psychologist may declare a state of practice independent of the
    // regional code.
    expect(BRAZILIAN_UFS).toContain('RR');
    expect(BRAZILIAN_UFS).toContain('AP');
    expect(BRAZILIAN_UFS).toContain('TO');
  });

  it('is sorted alphabetically', () => {
    const sorted = [...BRAZILIAN_UFS].sort();
    expect([...BRAZILIAN_UFS]).toEqual(sorted);
  });
});
