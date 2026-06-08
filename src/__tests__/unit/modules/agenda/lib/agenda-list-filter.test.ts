import { describe, expect, it } from 'vitest';

import {
  AGENDA_LIST_FILTERS,
  resolveAgendaListFilter,
} from '@/modules/agenda/lib/agenda-list-filter';

describe('resolveAgendaListFilter', () => {
  it('resolves the known filter value', () => {
    expect(resolveAgendaListFilter('sem-evolucao')).toBe('sem-evolucao');
  });

  it('returns null for an unknown string', () => {
    expect(resolveAgendaListFilter('xyz')).toBeNull();
  });

  it('returns null for the empty string', () => {
    expect(resolveAgendaListFilter('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveAgendaListFilter(undefined)).toBeNull();
  });

  it('returns null for an array, even when it contains a valid value', () => {
    // Repeated query params arrive as arrays; the allowlist only accepts a
    // single string, so this must NOT smuggle a valid filter through.
    expect(resolveAgendaListFilter(['sem-evolucao'])).toBeNull();
  });

  it('does not throw on any input shape', () => {
    expect(() => resolveAgendaListFilter('anything')).not.toThrow();
    expect(() => resolveAgendaListFilter(undefined)).not.toThrow();
    expect(() => resolveAgendaListFilter([])).not.toThrow();
  });
});

describe('AGENDA_LIST_FILTERS', () => {
  it('exposes the closed allowlist', () => {
    expect(AGENDA_LIST_FILTERS).toEqual(['sem-evolucao']);
  });
});
