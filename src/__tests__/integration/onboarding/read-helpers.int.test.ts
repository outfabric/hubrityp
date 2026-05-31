import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getNotificationPreferences, getOnboardingChecklist } from '@/modules/onboarding';
import { notificationPreferences, onboardingChecklist } from '@/shared/db/schema/onboarding/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Read-helper verification for the onboarding-data-model change (section 4):
//   * getOnboardingChecklist / getNotificationPreferences return the caller's
//     own row when run under that user's RLS-scoped client
//   * each returns null when no row exists yet (lazy-upsert first read)
//   * cross-tenant proof: user B's RLS client sees user A's row as absent
//     (helpers return null, never another tenant's data)
//
// The helpers receive the RLS-scoped Drizzle client injected as their first
// argument. We pass the per-user transaction produced by `runAsUser`, which
// sets `request.jwt.claims.sub` + role `authenticated` so RLS evaluates the
// connection exactly as a Supabase API request for that user.
// ---------------------------------------------------------------------------

// Insert an `auth.users` row. The `handle_new_user()` SECURITY DEFINER trigger
// materializes the matching `public.profiles` row from `raw_user_meta_data`, so
// the metadata it requires MUST be present or the INSERT rolls back. `crp_number`
// is made unique per user to avoid colliding on the CRP unique constraint.
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

afterEach(async () => {
  // Clean rows owned by our test users so files sharing the container don't
  // interfere. Delete children first, then the auth user.
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM onboarding_checklist
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM notification_preferences
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM profiles
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// getOnboardingChecklist
// ---------------------------------------------------------------------------

describe('getOnboardingChecklist', () => {
  it("returns the caller's own checklist row under their RLS client", async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);
    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId: userA });
    });

    const row = await runAsUser(userA, (db) => getOnboardingChecklist(db, userA));

    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userA);
    // Default from the data model, proving we read the real row.
    expect(row!.profileCompleted).toBe(false);
  });

  it('returns null when the caller has no checklist row yet', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    const row = await runAsUser(userA, (db) => getOnboardingChecklist(db, userA));

    expect(row).toBeNull();
  });

  it("does not return user A's checklist to user B (cross-tenant)", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId: userA });
    });

    // User B runs the helper. Even if a caller forged userId = A, RLS filters
    // the row out for B's session, so the helper returns null — never A's row.
    const rowForB = await runAsUser(userB, (db) => getOnboardingChecklist(db, userA));
    expect(rowForB).toBeNull();

    // B's own checklist also does not exist.
    const ownRowForB = await runAsUser(userB, (db) => getOnboardingChecklist(db, userB));
    expect(ownRowForB).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNotificationPreferences
// ---------------------------------------------------------------------------

describe('getNotificationPreferences', () => {
  it("returns the caller's own preferences row under their RLS client", async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);
    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId: userA });
    });

    const row = await runAsUser(userA, (db) => getNotificationPreferences(db, userA));

    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userA);
    // Default from the data model (opted in), proving we read the real row.
    expect(row!.emailDaily).toBe(true);
  });

  it('returns null when the caller has no preferences row yet', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    const row = await runAsUser(userA, (db) => getNotificationPreferences(db, userA));

    expect(row).toBeNull();
  });

  it("does not return user A's preferences to user B (cross-tenant)", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId: userA });
    });

    const rowForB = await runAsUser(userB, (db) => getNotificationPreferences(db, userA));
    expect(rowForB).toBeNull();

    const ownRowForB = await runAsUser(userB, (db) => getNotificationPreferences(db, userB));
    expect(ownRowForB).toBeNull();
  });
});
