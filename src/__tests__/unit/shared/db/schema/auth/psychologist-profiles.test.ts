import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Schema shape assertions. These tests exist so a column rename that breaks
// the manual SQL or downstream callers is caught at unit-test time, not in a
// failing integration run. The integration suite covers the runtime behavior
// (CHECK constraint, UNIQUE, RLS, triggers).
describe('psychologistProfiles table shape', () => {
  it('has the expected SQL table name', () => {
    expect(getTableName(psychologistProfiles)).toBe('psychologist_profiles');
  });

  it('declares every required column with the right SQL name', () => {
    const expected = [
      'user_id',
      'full_name',
      'crp_number',
      'crp_uf',
      'status',
      'terms_accepted_at',
      'privacy_accepted_at',
      'sensitive_data_consent_at',
      'terms_version',
      'privacy_version',
      'sensitive_data_consent_version',
      'status_changed_at',
      'created_at',
      'updated_at',
    ].sort();

    const actual = Object.values(psychologistProfiles)
      .filter((c): c is { name: string } => typeof c === 'object' && c !== null && 'name' in c)
      .map((c) => c.name)
      .sort();

    expect(actual).toEqual(expected);
  });

  it('marks every non-bookkeeping column as NOT NULL', () => {
    const cols = psychologistProfiles;
    expect(cols.userId.notNull).toBe(true);
    expect(cols.fullName.notNull).toBe(true);
    expect(cols.crpNumber.notNull).toBe(true);
    expect(cols.crpUf.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    expect(cols.termsAcceptedAt.notNull).toBe(true);
    expect(cols.privacyAcceptedAt.notNull).toBe(true);
    expect(cols.sensitiveDataConsentAt.notNull).toBe(true);
    expect(cols.termsVersion.notNull).toBe(true);
    expect(cols.privacyVersion.notNull).toBe(true);
    expect(cols.sensitiveDataConsentVersion.notNull).toBe(true);
    expect(cols.statusChangedAt.notNull).toBe(true);
    expect(cols.createdAt.notNull).toBe(true);
    expect(cols.updatedAt.notNull).toBe(true);
  });

  it('uses uuid for user_id and text for status', () => {
    expect(psychologistProfiles.userId.dataType).toBe('string');
    expect(psychologistProfiles.userId.columnType).toBe('PgUUID');
    expect(psychologistProfiles.status.columnType).toBe('PgText');
  });

  it('uses timestamptz for the consent and bookkeeping timestamps', () => {
    const tsCols = [
      psychologistProfiles.termsAcceptedAt,
      psychologistProfiles.privacyAcceptedAt,
      psychologistProfiles.sensitiveDataConsentAt,
      psychologistProfiles.statusChangedAt,
      psychologistProfiles.createdAt,
      psychologistProfiles.updatedAt,
    ];
    for (const col of tsCols) {
      expect(col.columnType).toBe('PgTimestamp');
    }
  });
});
