import { describe, expect, it } from 'vitest';

import {
  isCrpRegionalConsistentWithUf,
  isValidCrpFormat,
  parseCrpNumber,
} from '@/modules/registration/lib/crp-validators';

describe('isValidCrpFormat', () => {
  it('accepts the canonical NN/NNNNNN form', () => {
    expect(isValidCrpFormat('06/123456')).toBe(true);
  });

  it('accepts the minimum serial length (4 digits) and maximum (7 digits)', () => {
    expect(isValidCrpFormat('06/1234')).toBe(true);
    expect(isValidCrpFormat('06/1234567')).toBe(true);
  });

  it('accepts any 2-digit regional, even unassigned ones (semantic check is elsewhere)', () => {
    expect(isValidCrpFormat('99/123456')).toBe(true);
  });

  it('rejects a single-digit regional', () => {
    expect(isValidCrpFormat('6/12345')).toBe(false);
  });

  it('rejects a hyphen separator instead of slash', () => {
    expect(isValidCrpFormat('06-123456')).toBe(false);
  });

  it('rejects a serial shorter than 4 digits', () => {
    expect(isValidCrpFormat('06/12')).toBe(false);
    expect(isValidCrpFormat('06/123')).toBe(false);
  });

  it('rejects a serial longer than 7 digits', () => {
    expect(isValidCrpFormat('06/12345678')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidCrpFormat('')).toBe(false);
  });

  it('rejects strings without the slash separator', () => {
    expect(isValidCrpFormat('06123456')).toBe(false);
  });

  it('rejects letters anywhere in the value', () => {
    expect(isValidCrpFormat('A6/123456')).toBe(false);
    expect(isValidCrpFormat('06/12345A')).toBe(false);
  });

  it('rejects whitespace surrounding the value', () => {
    expect(isValidCrpFormat(' 06/123456')).toBe(false);
    expect(isValidCrpFormat('06/123456 ')).toBe(false);
  });

  it('rejects an empty serial after the slash', () => {
    expect(isValidCrpFormat('06/')).toBe(false);
  });
});

describe('parseCrpNumber', () => {
  it('parses the canonical form into regional + serial halves', () => {
    expect(parseCrpNumber('06/123456')).toEqual({ regional: '06', serial: '123456' });
  });

  it('parses every regional/serial combination at the format boundaries', () => {
    expect(parseCrpNumber('20/1234')).toEqual({ regional: '20', serial: '1234' });
    expect(parseCrpNumber('20/1234567')).toEqual({ regional: '20', serial: '1234567' });
  });

  it('returns null for malformed inputs', () => {
    expect(parseCrpNumber('6/123456')).toBeNull();
    expect(parseCrpNumber('06-123456')).toBeNull();
    expect(parseCrpNumber('06/12')).toBeNull();
    expect(parseCrpNumber('06/')).toBeNull();
    expect(parseCrpNumber('')).toBeNull();
  });
});

describe('isCrpRegionalConsistentWithUf', () => {
  it('returns true for the canonical happy path (06 → SP)', () => {
    expect(isCrpRegionalConsistentWithUf('06/123456', 'SP')).toBe(true);
  });

  it('returns false when the regional code maps to a different UF', () => {
    expect(isCrpRegionalConsistentWithUf('06/123456', 'RJ')).toBe(false);
  });

  it('returns true for 05 → RJ (the spec example for a different regional)', () => {
    expect(isCrpRegionalConsistentWithUf('05/123456', 'RJ')).toBe(true);
  });

  it('returns false for 05 → SP (the spec example proving the symmetry)', () => {
    expect(isCrpRegionalConsistentWithUf('05/123456', 'SP')).toBe(false);
  });

  it('handles every other Apêndice A 1:1 mapping correctly', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['01', 'DF'],
      ['02', 'PE'],
      ['03', 'BA'],
      ['04', 'MG'],
      ['07', 'RS'],
      ['08', 'PR'],
      ['09', 'GO'],
      ['10', 'PA'],
      ['11', 'CE'],
      ['12', 'SC'],
      ['13', 'PB'],
      ['14', 'MS'],
      ['15', 'AL'],
      ['16', 'ES'],
      ['17', 'RN'],
      ['18', 'MT'],
      ['19', 'SE'],
      ['21', 'PI'],
      ['22', 'MA'],
      ['23', 'TO'],
      ['24', 'AP'],
    ];
    for (const [regional, uf] of cases) {
      expect(
        isCrpRegionalConsistentWithUf(`${regional}/123456`, uf),
        `expected ${regional} → ${uf} to be consistent`,
      ).toBe(true);
    }
  });

  it('handles the 1:N CRP-20 council (covers AM, RR, AC, RO)', () => {
    for (const uf of ['AM', 'RR', 'AC', 'RO']) {
      expect(isCrpRegionalConsistentWithUf('20/123456', uf), `20 → ${uf} should be consistent`).toBe(
        true,
      );
    }
  });

  it('rejects UFs not covered by CRP-20', () => {
    for (const uf of ['SP', 'RJ', 'DF', 'BA', 'MG']) {
      expect(isCrpRegionalConsistentWithUf('20/123456', uf)).toBe(false);
    }
  });

  it('returns false for unknown regional prefixes (e.g. "99")', () => {
    expect(isCrpRegionalConsistentWithUf('99/123456', 'SP')).toBe(false);
  });

  it('returns false (does not throw) for malformed CRP inputs', () => {
    expect(isCrpRegionalConsistentWithUf('6/12345', 'SP')).toBe(false);
    expect(isCrpRegionalConsistentWithUf('06-123456', 'SP')).toBe(false);
    expect(isCrpRegionalConsistentWithUf('', 'SP')).toBe(false);
    expect(isCrpRegionalConsistentWithUf('06/', 'SP')).toBe(false);
  });

  it('returns false for an unknown UF, even with a valid regional prefix', () => {
    expect(isCrpRegionalConsistentWithUf('06/123456', 'XX')).toBe(false);
  });
});
