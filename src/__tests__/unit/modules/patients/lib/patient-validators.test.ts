import { describe, expect, it } from 'vitest';

import {
  formatPhone,
  isValidBrazilianPhone,
  isValidCpf,
} from '@/modules/patients/lib/patient-validators';

describe('isValidBrazilianPhone', () => {
  describe('valid formats', () => {
    it('accepts canonical format: +55 11 91234-5678', () => {
      expect(isValidBrazilianPhone('+55 11 91234-5678')).toBe(true);
    });

    it('accepts other valid DDDs', () => {
      expect(isValidBrazilianPhone('+55 21 99876-5432')).toBe(true);
      expect(isValidBrazilianPhone('+55 85 98765-4321')).toBe(true);
      expect(isValidBrazilianPhone('+55 71 91111-2222')).toBe(true);
    });

    it('accepts mobile number starting with 9 (all 5-digit prefixes start with 9)', () => {
      expect(isValidBrazilianPhone('+55 11 90000-0000')).toBe(true);
      expect(isValidBrazilianPhone('+55 11 99999-9999')).toBe(true);
    });
  });

  describe('invalid formats', () => {
    it('rejects missing country code', () => {
      expect(isValidBrazilianPhone('11 91234-5678')).toBe(false);
    });

    it('rejects country code without +', () => {
      expect(isValidBrazilianPhone('55 11 91234-5678')).toBe(false);
    });

    it('rejects single-digit DDD', () => {
      expect(isValidBrazilianPhone('+55 1 91234-5678')).toBe(false);
    });

    it('rejects three-digit DDD', () => {
      expect(isValidBrazilianPhone('+55 011 91234-5678')).toBe(false);
    });

    it('rejects landline number (8-digit, not starting with 9)', () => {
      expect(isValidBrazilianPhone('+55 11 3234-5678')).toBe(false);
    });

    it('rejects mobile number without hyphen', () => {
      expect(isValidBrazilianPhone('+55 11 912345678')).toBe(false);
    });

    it('rejects number with extra spaces', () => {
      expect(isValidBrazilianPhone('+55  11 91234-5678')).toBe(false);
    });

    it('rejects number with leading/trailing whitespace', () => {
      expect(isValidBrazilianPhone(' +55 11 91234-5678')).toBe(false);
      expect(isValidBrazilianPhone('+55 11 91234-5678 ')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidBrazilianPhone('')).toBe(false);
    });

    it('rejects number with letters', () => {
      expect(isValidBrazilianPhone('+55 11 9ABCD-5678')).toBe(false);
    });

    it('rejects non-Brazilian country code', () => {
      expect(isValidBrazilianPhone('+1 11 91234-5678')).toBe(false);
    });

    it('rejects number with parentheses around DDD', () => {
      expect(isValidBrazilianPhone('+55 (11) 91234-5678')).toBe(false);
    });
  });
});

describe('isValidCpf', () => {
  describe('valid CPFs', () => {
    it('accepts a valid formatted CPF', () => {
      // Known valid CPF (passes check-digit algorithm)
      expect(isValidCpf('529.982.247-25')).toBe(true);
    });

    it('accepts a valid unformatted CPF', () => {
      expect(isValidCpf('52998224725')).toBe(true);
    });

    it('accepts another valid CPF', () => {
      expect(isValidCpf('453.178.287-91')).toBe(true);
    });
  });

  describe('invalid CPFs', () => {
    it('rejects CPF with all same digits: 000.000.000-00', () => {
      expect(isValidCpf('000.000.000-00')).toBe(false);
    });

    it('rejects CPF with all same digits: 111.111.111-11', () => {
      expect(isValidCpf('111.111.111-11')).toBe(false);
    });

    it('rejects CPF with all same digits: 222.222.222-22', () => {
      expect(isValidCpf('222.222.222-22')).toBe(false);
    });

    it('rejects CPF with all same digits: 333.333.333-33', () => {
      expect(isValidCpf('333.333.333-33')).toBe(false);
    });

    it('rejects CPF with all same digits: 444.444.444-44', () => {
      expect(isValidCpf('444.444.444-44')).toBe(false);
    });

    it('rejects CPF with all same digits: 555.555.555-55', () => {
      expect(isValidCpf('555.555.555-55')).toBe(false);
    });

    it('rejects CPF with all same digits: 666.666.666-66', () => {
      expect(isValidCpf('666.666.666-66')).toBe(false);
    });

    it('rejects CPF with all same digits: 777.777.777-77', () => {
      expect(isValidCpf('777.777.777-77')).toBe(false);
    });

    it('rejects CPF with all same digits: 888.888.888-88', () => {
      expect(isValidCpf('888.888.888-88')).toBe(false);
    });

    it('rejects CPF with all same digits: 999.999.999-99', () => {
      expect(isValidCpf('999.999.999-99')).toBe(false);
    });

    it('rejects CPF with invalid check digits', () => {
      // Valid structure but wrong check digits
      expect(isValidCpf('529.982.247-26')).toBe(false);
    });

    it('rejects CPF that is too short', () => {
      expect(isValidCpf('123.456.789')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidCpf('')).toBe(false);
    });

    it('rejects CPF with letters', () => {
      expect(isValidCpf('529.982.24A-25')).toBe(false);
    });

    it('rejects CPF with too many digits', () => {
      expect(isValidCpf('529.982.247-251')).toBe(false);
    });
  });
});

describe('formatPhone', () => {
  it('formats 13-digit string with country code', () => {
    expect(formatPhone('5511912345678')).toBe('+55 11 91234-5678');
  });

  it('formats 11-digit string without country code', () => {
    expect(formatPhone('11912345678')).toBe('+55 11 91234-5678');
  });

  it('formats string that already has the canonical format (no-op)', () => {
    expect(formatPhone('+55 11 91234-5678')).toBe('+55 11 91234-5678');
  });

  it('strips non-digit characters and formats', () => {
    expect(formatPhone('(11) 91234-5678')).toBe('+55 11 91234-5678');
  });

  it('strips country code prefix with + and formats', () => {
    expect(formatPhone('+55 (11) 91234-5678')).toBe('+55 11 91234-5678');
  });

  it('returns original string when digit count is not 11 or 13', () => {
    expect(formatPhone('1234')).toBe('1234');
    expect(formatPhone('123456789012345')).toBe('123456789012345');
  });

  it('returns original string for 13 digits not starting with 55', () => {
    expect(formatPhone('1234567890123')).toBe('1234567890123');
  });

  it('handles empty string gracefully', () => {
    expect(formatPhone('')).toBe('');
  });
});
