import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';
import { markCrpValidated } from './helpers/markCrpValidated';

// Functional coverage for the `handle_email_confirmed()` trigger
// installed by the section-2 migration. This test directly drives the
// `auth.users.email_confirmed_at` column via the same path that GoTrue
// would use when the user clicks the verification link, then asserts
// the trigger flipped `profiles.status` and mirrored the timestamp into
// `profiles.email_verified_at`.
//
// We use `runAsService` (RLS-bypass / superuser) for both the seed and
// the assertions because the trigger function is `SECURITY DEFINER` and
// the table-level UPDATE on `auth.users` is normally a service-role
// operation in production.

type ProfileSnapshot = {
  status: string;
  email_verified_at: Date | null;
};

async function seedAuthUserWithProfile(): Promise<{ userId: string; email: string }> {
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

  await runAsService(async (db) => {
    // The on_auth_user_created trigger materializes `profiles` from
    // `raw_user_meta_data` — same path as a real signup.
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
  });

  return { userId, email };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
    await db.execute(dsql`DELETE FROM auth_logs`);
  });
});

describe('handle_email_confirmed() trigger (integration)', () => {
  it('starts the profile in pending_verification with email_verified_at null', async () => {
    const { userId } = await seedAuthUserWithProfile();

    const [profile] = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)),
    );

    expect(profile).toBeDefined();
    expect(profile!.status).toBe('pending_verification');
    expect(profile!.emailVerifiedAt).toBeNull();
  });

  it('transitions pending_verification → pending_crp_validation when email_confirmed_at flips NULL → NOT NULL', async () => {
    const { userId } = await seedAuthUserWithProfile();

    // Simulate the email-confirmation event: GoTrue stamps
    // `email_confirmed_at` after the user clicks the link.
    const confirmedAt = new Date();
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE auth.users SET email_confirmed_at = ${confirmedAt.toISOString()} WHERE id = ${userId}`,
      );
    });

    const [after] = await runAsService(async (db) =>
      db
        .select({ status: profiles.status, emailVerifiedAt: profiles.emailVerifiedAt })
        .from(profiles)
        .where(eq(profiles.userId, userId)),
    );

    expect(after!.status).toBe('pending_crp_validation');
    // The trigger mirrors the SAME timestamp it observed onto the
    // profile row — millisecond precision may differ across drivers,
    // so we compare via `toISOString()` truncated to seconds.
    expect(after!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(after!.emailVerifiedAt!.toISOString().slice(0, 19)).toBe(
      confirmedAt.toISOString().slice(0, 19),
    );
  });

  it('is idempotent — repeating the UPDATE on an active profile does NOT regress status', async () => {
    const { userId } = await seedAuthUserWithProfile();

    // Walk the lifecycle: pending_verification → email confirmed →
    // pending_crp_validation → CRP validated → active.
    await runAsService(async (db) => {
      await db.execute(dsql`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${userId}`);
    });
    await markCrpValidated(userId);

    const [active] = await runAsService(async (db) =>
      db.select({ status: profiles.status }).from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(active!.status).toBe('active');

    // Re-emit the email-confirmation UPDATE (e.g. Supabase reconfirming
    // a session). The trigger guards on `OLD.email_confirmed_at IS NULL
    // AND NEW.email_confirmed_at IS NOT NULL`, so on the second UPDATE
    // OLD is non-null and the body short-circuits. Even if it fired,
    // the inner WHERE clause filters to `status = 'pending_verification'`
    // — `active` doesn't match.
    await runAsService(async (db) => {
      await db.execute(dsql`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${userId}`);
    });

    const [stillActive] = await runAsService(async (db) =>
      db.select({ status: profiles.status }).from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(stillActive!.status).toBe('active');
  });

  it('does not touch the profile when the UPDATE leaves email_confirmed_at NULL', async () => {
    const { userId } = await seedAuthUserWithProfile();

    // Bump some other column on auth.users — `role` is plain text — so
    // the trigger fires BUT the body's NULL→NOT NULL guard short-circuits.
    // Note: this trigger is scoped to `AFTER UPDATE OF email_confirmed_at`
    // so it shouldn't even fire on a non-email column. We verify this by
    // observing that `email_verified_at` stays null and `status` stays
    // `pending_verification` after a no-op UPDATE.
    await runAsService(async (db) => {
      await db.execute(dsql`UPDATE auth.users SET role = 'authenticated' WHERE id = ${userId}`);
    });

    const [unchanged] = await runAsService(async (db) =>
      db
        .select({ status: profiles.status, emailVerifiedAt: profiles.emailVerifiedAt })
        .from(profiles)
        .where(eq(profiles.userId, userId)),
    );
    const snap: ProfileSnapshot = {
      status: unchanged!.status,
      email_verified_at: unchanged!.emailVerifiedAt,
    };
    expect(snap.status).toBe('pending_verification');
    expect(snap.email_verified_at).toBeNull();
  });
});
