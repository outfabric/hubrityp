import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/shared/db/client';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';

// Functional coverage for `getCurrentProfile(supabase)` — the canonical
// adapter from a Supabase session to a typed `profiles` row. Asserts:
//   • An authenticated session with a real `profiles` row returns the
//     typed Profile.
//   • No session → null (no DB access).
//   • Authenticated session but profile missing (race window) → null.
//   • The function performs at MOST one SELECT against `profiles` per
//     call (P95 < 50ms requires no extra round trips).
//
// We spy on `db.select` to count the SELECT roundtrips. The real
// Drizzle client backs the test container (DATABASE_URL is injected by
// `global-setup.ts`), so this is a true integration test of the
// adapter against a real Postgres.

type FakeSupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
};

function buildSupabase(userId: string | null): FakeSupabaseClient {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- shaped to match the SupabaseClient surface, which returns a Promise even on synchronous resolution
      getUser: async () => ({ data: { user: userId ? { id: userId } : null } }),
    },
  };
}

async function seedProfile(): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  const email = signupInputFactory.uniqueEmail();
  const meta = {
    fullName: 'Maria Silva',
    crpNumber: signupInputFactory.uniqueCrpNumber(),
    crpUf: 'SP',
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    sensitiveDataConsentAt: new Date().toISOString(),
  };
  await runAsService(async (sdb) => {
    await sdb.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
  });
  return { userId, email };
}

let selectSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // Spy on the Drizzle client's `select` so we can assert exactly ONE
  // SELECT per `getCurrentProfile` call. `vi.spyOn` keeps the original
  // implementation in place, so the real query still hits Postgres.
  selectSpy = vi.spyOn(db, 'select');
});

afterEach(async () => {
  selectSpy?.mockRestore();
  selectSpy = null;
  // Do NOT call `vi.resetModules()` here. The spy above is bound to
  // the `db` instance imported at this file's top — resetting modules
  // would force the impl-under-test to re-import a FRESH `db`, leaving
  // our spy attached to a stale module instance and the call counts
  // empty across test cases.
  await runAsService(async (sdb) => {
    await sdb.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('getCurrentProfile (integration, Drizzle-backed)', () => {
  it('returns the typed Profile for an authenticated session whose row exists', async () => {
    const { userId, email } = await seedProfile();
    const supabase = buildSupabase(userId);

    const { getCurrentProfile } = await import('@/modules/registration/server/get-profile');

    const profile = await getCurrentProfile(
      // The function only reads `auth.getUser`; the rich Supabase API
      // surface isn't needed here. The cast keeps the type-narrow
      // SupabaseClient parameter happy.
      supabase as unknown as Parameters<typeof getCurrentProfile>[0],
    );

    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe(userId);
    expect(profile!.email).toBe(email);
    expect(profile!.fullName).toBe('Maria Silva');
    expect(profile!.status).toBe('pending_verification');

    // Performance contract: exactly ONE SELECT against `profiles`.
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when there is no session (and never queries the DB)', async () => {
    const supabase = buildSupabase(null);
    const { getCurrentProfile } = await import('@/modules/registration/server/get-profile');

    const result = await getCurrentProfile(
      supabase as unknown as Parameters<typeof getCurrentProfile>[0],
    );

    expect(result).toBeNull();
    // No SELECT happened — the function short-circuits before Drizzle
    // even constructs a query.
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('returns null when authenticated but the profile row is missing (race window)', async () => {
    // Stage an authenticated session for a user that does NOT have a
    // matching `profiles` row. This mimics the brief window between
    // `auth.signUp` returning and the `handle_new_user` trigger
    // committing — the middleware/Server Actions treat both shapes
    // identically (anonymous-equivalent for redirect logic).
    const orphanUserId = randomUUID();
    const supabase = buildSupabase(orphanUserId);

    const { getCurrentProfile } = await import('@/modules/registration/server/get-profile');

    const result = await getCurrentProfile(
      supabase as unknown as Parameters<typeof getCurrentProfile>[0],
    );

    expect(result).toBeNull();
    // The function still performed exactly one SELECT — that's how it
    // distinguishes "missing" from "exists" — it just returned no rows.
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('narrows status to ProfileStatus on the returned object', async () => {
    const { userId } = await seedProfile();
    const supabase = buildSupabase(userId);

    const { getCurrentProfile } = await import('@/modules/registration/server/get-profile');
    const profile = await getCurrentProfile(
      supabase as unknown as Parameters<typeof getCurrentProfile>[0],
    );

    // The lib-level type asserts `profile.status` is the closed enum.
    // The runtime invariant is that the value is one of the enum's
    // string members — we verify the seeded value falls in that set.
    expect(
      [
        'pending_verification',
        'pending_crp_validation',
        'active',
        'suspended',
        'cancelled',
      ].includes(profile!.status),
    ).toBe(true);
  });
});
