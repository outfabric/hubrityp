import { describe, expect, it } from 'vitest';

import {
  PATIENT_LIST_FILTERS,
  resolvePatientListFilter,
} from '@/modules/patients/lib/patient-list-filter';

describe('PATIENT_LIST_FILTERS', () => {
  it('is the closed allowlist of supported filters', () => {
    expect(PATIENT_LIST_FILTERS).toEqual(['sem-consentimento']);
  });
});

describe('resolvePatientListFilter', () => {
  it('resolves the known filter to itself', () => {
    expect(resolvePatientListFilter('sem-consentimento')).toBe('sem-consentimento');
  });

  it('returns null for an unknown value', () => {
    expect(resolvePatientListFilter('xyz')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(resolvePatientListFilter('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolvePatientListFilter(undefined)).toBeNull();
  });

  it('returns null for an array (repeated query param)', () => {
    expect(resolvePatientListFilter(['sem-consentimento'])).toBeNull();
  });
});
