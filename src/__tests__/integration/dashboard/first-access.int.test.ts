import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { stampFirstAccess } from '@/modules/dashboard';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Insert an `auth.users` row. The `handle_new_user()` SECURITY DEFINER trigger
// (migration 0001) fires on this INSERT and materializes the matching
// `public.profiles` row from `raw_user_meta_data`, so the metadata fields it
// requires MUST be present or the whole INSERT rolls back. The freshly created
// profile has `first_access_at = NULL` (nullable, no value supplied), which is
// exactly the pre-stamp state under test. `crp_number` is sliced from the UUID
// so two seeded users never collide on `profiles_crp_number_crp_uf_unique`.
async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Test Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function readFirstAccessAt(userId: string): Promise<Date | null> {
  const rows = await runAsService(async (db) => {
    return db.execute(dsql`SELECT first_access_at FROM profiles WHERE user_id = ${userId}`);
  });
  const value = (rows[0] as { first_access_at: string | null } | undefined)?.first_access_at;
  return value ? new Date(value) : null;
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof stampFirstAccess>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// A clean slate before the suite: the reused container retains rows from prior
// suites. `cleanTestData()` cascades profiles via the `auth.users` delete (the
// `profiles` PK is the FK to `auth.users(id)` with ON DELETE CASCADE).
beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stampFirstAccess — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await stampFirstAccess(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('stamps first_access_at on the first call (was NULL)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Precondition: a freshly created profile has no first-access timestamp.
    expect(await readFirstAccessAt(userId)).toBeNull();

    const result = await stampFirstAccess(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stamped).toBe(true);

    const stampedAt = await readFirstAccessAt(userId);
    expect(stampedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a second call does not overwrite the original instant', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const first = await stampFirstAccess(fakeSupabaseClient(userId));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.stamped).toBe(true);

    const firstStampedAt = await readFirstAccessAt(userId);
    expect(firstStampedAt).toBeInstanceOf(Date);

    // Second call: the `IS NULL` guard makes it a no-op — no row written.
    const second = await stampFirstAccess(fakeSupabaseClient(userId));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stamped).toBe(false);

    // The persisted timestamp is unchanged (not bumped to a later `now()`).
    const secondStampedAt = await readFirstAccessAt(userId);
    expect(secondStampedAt?.getTime()).toBe(firstStampedAt?.getTime());
  });

  it('only touches the caller row: a cross-user write is impossible', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // A stamps its own first access.
    const result = await stampFirstAccess(fakeSupabaseClient(userA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stamped).toBe(true);

    // A's row is stamped; B's row remains untouched (still NULL). The action
    // never accepts a caller-supplied id, so it can only ever write `auth.uid()`.
    expect(await readFirstAccessAt(userA)).toBeInstanceOf(Date);
    expect(await readFirstAccessAt(userB)).toBeNull();
  });
});
