import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';

// Shape assertions for the admin-only validation queue. Runtime RLS is
// covered by the integration suite; this test guards against accidental
// schema drift.
describe('crpValidationQueue table shape', () => {
  it('has the expected SQL table name', () => {
    expect(getTableName(crpValidationQueue)).toBe('crp_validation_queue');
  });

  it('declares every required column with the right SQL name', () => {
    const expected = [
      'id',
      'user_id',
      'crp_number',
      'crp_uf',
      'status',
      'submitted_at',
      'decided_at',
      'decided_by',
      'rejection_reason',
    ].sort();

    const actual = Object.values(crpValidationQueue)
      .filter((c): c is { name: string } => typeof c === 'object' && c !== null && 'name' in c)
      .map((c) => c.name)
      .sort();

    expect(actual).toEqual(expected);
  });

  it('marks the operational columns as NOT NULL and the decision columns as nullable', () => {
    const cols = crpValidationQueue;
    expect(cols.id.notNull).toBe(true);
    expect(cols.userId.notNull).toBe(true);
    expect(cols.crpNumber.notNull).toBe(true);
    expect(cols.crpUf.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    expect(cols.submittedAt.notNull).toBe(true);
    // Decision columns are nullable until an admin acts.
    expect(cols.decidedAt.notNull).toBe(false);
    expect(cols.decidedBy.notNull).toBe(false);
    expect(cols.rejectionReason.notNull).toBe(false);
  });

  it('uses uuid for id and user_id', () => {
    expect(crpValidationQueue.id.columnType).toBe('PgUUID');
    expect(crpValidationQueue.userId.columnType).toBe('PgUUID');
  });
});
