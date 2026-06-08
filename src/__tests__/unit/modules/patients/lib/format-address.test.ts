import { describe, it, expect } from 'vitest';

import { formatAddress } from '@/modules/patients/lib/format-address';

describe('formatAddress', () => {
  it('formats a full address in Brazilian display order', () => {
    const json = JSON.stringify({
      street: 'Rua Exemplo',
      number: '123',
      complement: 'Apto 4',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01001-000',
    });

    expect(formatAddress(json)).toBe('Rua Exemplo, 123, Apto 4 - Centro - São Paulo, SP 01001-000');
  });

  it('skips missing parts and collapses separators for a partial address', () => {
    const json = JSON.stringify({
      street: 'Av. Brasil',
      number: '500',
      city: 'Campinas',
      state: 'SP',
    });

    expect(formatAddress(json)).toBe('Av. Brasil, 500 - Campinas, SP');
  });

  it('returns null for a null input', () => {
    expect(formatAddress(null)).toBeNull();
  });

  it('returns null for an empty object with no usable fields', () => {
    expect(formatAddress('{}')).toBeNull();
  });

  it('returns null when every field is blank or whitespace-only', () => {
    const json = JSON.stringify({
      street: '   ',
      number: '',
      city: '\t',
    });

    expect(formatAddress(json)).toBeNull();
  });

  it('returns null for corrupted / unparseable JSON', () => {
    expect(formatAddress('{not valid json')).toBeNull();
  });

  it('returns null when the JSON parses to a non-object primitive', () => {
    expect(formatAddress('"just a string"')).toBeNull();
    expect(formatAddress('42')).toBeNull();
    expect(formatAddress('null')).toBeNull();
  });

  it('ignores non-string field values defensively', () => {
    const json = JSON.stringify({
      street: 'Rua Um',
      number: 123,
      complement: { foo: 'bar' },
    });

    expect(formatAddress(json)).toBe('Rua Um');
  });
});
