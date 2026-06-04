import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { completeTourImpl } from '@/modules/onboarding';
import { profiles } from '@/shared/db/schema/auth/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// completeTourImpl — real Postgres (Testcontainers)
//
// Proves the section-3 tour-completion contract:
//   * stamps `profiles.tour_completed_at` for the authenticated owner
//   * is idempotent — a second call does NOT overwrite the first instant
//   * returns UNAUTHORIZED with no session and writes nothing
//   * the function takes no payload, so a (hypothetical) client userId can never
//     redirect the write to another account — only the session uid row is touched
//   * cross-user RLS holds: a user can never write/clear another user's stamp
// ---------------------------------------------------------------------------

// `handle_new_user()` (SECURITY DEFINER trigger) materializes `public.profiles`
// from `raw_user_meta_data`, so the metadata it requires MUST be present.
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

async function readTourCompletedAt(userId: string): Promise<Date | null> {
  return runAsService(async (db) => {
    const rows = await db
      .select({ tourCompletedAt: profiles.tourCompletedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return rows[0]?.tourCompletedAt ?? null;
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof completeTourImpl>[0];
}

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('completeTourImpl — real Postgres', () => {
  it('returns UNAUTHORIZED and writes nothing when there is no session', async () => {
    const result = await completeTourImpl(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it("stamps tour_completed_at for the authenticated owner's row", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    expect(await readTourCompletedAt(userId)).toBeNull();

    const result = await completeTourImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stamped).toBe(true);

    expect(await readTourCompletedAt(userId)).toBeInstanceOf(Date);
  });

  it('is idempotent: a second call does not overwrite the first instant', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const first = await completeTourImpl(fakeSupabaseClient(userId));
    expect(first.ok && first.stamped).toBe(true);
    const firstStamp = await readTourCompletedAt(userId);
    expect(firstStamp).toBeInstanceOf(Date);

    const second = await completeTourImpl(fakeSupabaseClient(userId));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // The IS NULL guard makes the second call a no-op — nothing was written.
    expect(second.stamped).toBe(false);

    const secondStamp = await readTourCompletedAt(userId);
    expect(secondStamp?.getTime()).toBe(firstStamp?.getTime());
  });

  it('writes only the session uid row, never another account (client id is irrelevant)', async () => {
    // The function takes no payload, so the only thing that decides the written
    // row is the authenticated session. Authenticating as B stamps B's row; A's
    // row stays untouched.
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const result = await completeTourImpl(fakeSupabaseClient(userB));
    expect(result.ok && result.stamped).toBe(true);

    expect(await readTourCompletedAt(userB)).toBeInstanceOf(Date);
    expect(await readTourCompletedAt(userA)).toBeNull();
  });

  it("enforces cross-user RLS: a user cannot stamp another user's profile row", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Under B's RLS-scoped connection, attempt to set A's tour_completed_at.
    // RLS must scope the UPDATE to B's own row, so A's row stays NULL.
    await runAsUser(userB, async (db) => {
      await db
        .update(profiles)
        .set({ tourCompletedAt: dsql`now()` })
        .where(eq(profiles.userId, userA));
    });

    expect(await readTourCompletedAt(userA)).toBeNull();
  });
});
