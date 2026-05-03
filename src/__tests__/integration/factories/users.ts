import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { applyTransition, documentVersions } from '@/modules/account-lifecycle';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import { runAsService } from '../setup/run-as-service';

// Lifecycle-driven user factories used by integration tests (and ported into
// the seeded e2e setup via a thin wrapper).
//
// Contract:
//   • Each helper inserts a fresh `auth.users` row + a `psychologist_profiles`
//     row at status `pending_verification` (the canonical signup state) using
//     the schema's defaults, then drives the state machine via
//     `applyTransition` to reach the target status.
//   • The factories are intentionally STRICT about the spec invariant
//     ("transitionStatus helper is the single writer of status"): they never
//     touch the `status` column directly. The `no-direct-status-writes`
//     CI guard is kept honest at the test layer too.
//   • CRP numbers are random per call (`06/<6-digit-random>`) to avoid
//     collisions on the (crp_number, crp_uf) UNIQUE constraint when several
//     factory rows coexist within the same suite.
//   • The helpers run with the service-role connection (RLS bypassed) so the
//     bootstrap-stub `auth.users` row + the `psychologist_profiles` insert
//     succeed regardless of the test's RLS context.

export type SeededUser = {
  userId: string;
  email: string;
  crpNumber: string;
  crpUf: string;
  fullName: string;
};

type SeedOverrides = Partial<SeededUser> & {
  // `password` is NOT stored in `psychologist_profiles` — it lives in
  // `auth.users.encrypted_password`. The bootstrap stub does not maintain
  // password storage (real GoTrue handles that). Tests that need to drive
  // a real Supabase signin against this row must seed the password through
  // the Auth admin client separately. The factory stays focused on the
  // `psychologist_profiles` lifecycle.
  password?: never;
};

// Common seed scaffolding: pick defaults, insert auth.users (idempotent) and
// the profile row at `pending_verification`. Returns the resolved identity so
// the caller can drive transitions on the same userId.
async function seedBaseProfile(overrides: SeedOverrides = {}): Promise<SeededUser> {
  const userId = overrides.userId ?? randomUUID();
  const email = overrides.email ?? `${userId}@test.local`;
  const crpNumber =
    overrides.crpNumber ?? `06/${String(Math.floor(100000 + Math.random() * 900000))}`;
  const crpUf = overrides.crpUf ?? 'SP';
  const fullName = overrides.fullName ?? 'Dra. Factory';

  await runAsService(async (db) => {
    // Bootstrap-stub `auth.users` carries id/email/raw_app_meta_data only —
    // see `src/__tests__/e2e/_shared/postgres-container.ts`. Real Supabase
    // adds many more columns, but our integration tests only exercise what
    // the FK from `psychologist_profiles.user_id` and the AFTER UPDATE
    // trigger on `auth.users.raw_app_meta_data` need.
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );

    const now = new Date();
    await db.insert(psychologistProfiles).values({
      userId,
      fullName,
      crpNumber,
      crpUf,
      // `pending_verification` is the canonical signup status; every
      // transition chain starts here.
      status: 'pending_verification',
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      sensitiveDataConsentAt: now,
      termsVersion: documentVersions.terms,
      privacyVersion: documentVersions.privacy,
      sensitiveDataConsentVersion: documentVersions.sensitiveData,
    });
  });

  return { userId, email, crpNumber, crpUf, fullName };
}

// Drive a transition and throw on failure. Wrapping `applyTransition` here
// (instead of returning the union to the caller) keeps the factory call sites
// terse — a factory that "couldn't reach the target status" is a test bug,
// not a domain error to propagate.
async function driveTransition(
  userId: string,
  event: Parameters<typeof applyTransition>[1],
): Promise<void> {
  const result = await applyTransition(userId, event);
  if (!result.ok) {
    throw new Error(
      `users factory: applyTransition(${userId}, ${event}) failed: ${result.error}. ` +
        'This indicates the factory chain is out of sync with the state machine.',
    );
  }
}

// `pending_verification` — the canonical signup state. No transitions needed.
export async function seedPendingVerificationUser(
  overrides: SeedOverrides = {},
): Promise<SeededUser> {
  return seedBaseProfile(overrides);
}

// `pending_crp_validation` — email verified, awaiting CRP review.
//
// Chain: pending_verification → email_verified → pending_crp_validation.
export async function seedPendingCrpUser(overrides: SeedOverrides = {}): Promise<SeededUser> {
  const seeded = await seedBaseProfile(overrides);
  await driveTransition(seeded.userId, 'email_verified');
  return seeded;
}

// `active` — fully onboarded user. Chain:
//   pending_verification → email_verified → pending_crp_validation
//   → crp_approved → active.
export async function seedActiveUser(overrides: SeedOverrides = {}): Promise<SeededUser> {
  const seeded = await seedBaseProfile(overrides);
  await driveTransition(seeded.userId, 'email_verified');
  await driveTransition(seeded.userId, 'crp_approved');
  return seeded;
}

// `suspended` — typical path is CRP rejection at review time.
//
// Chain: pending_verification → email_verified → pending_crp_validation
//   → crp_rejected → suspended.
//
// The alternate path (active → admin_suspend) is also valid in the state
// machine, but the rejection-at-review path is the realistic suspension flow
// for this MVP (admins suspend via CRP rejection; explicit `admin_suspend`
// has no UI yet). Tests that specifically need to exercise the
// `admin_suspend` transition can call `applyTransition` directly.
export async function seedSuspendedUser(overrides: SeedOverrides = {}): Promise<SeededUser> {
  const seeded = await seedBaseProfile(overrides);
  await driveTransition(seeded.userId, 'email_verified');
  await driveTransition(seeded.userId, 'crp_rejected');
  return seeded;
}

// `cancelled` — user-initiated termination after activation.
//
// Chain: pending_verification → email_verified → pending_crp_validation
//   → crp_approved → active → user_cancel → cancelled.
export async function seedCancelledUser(overrides: SeedOverrides = {}): Promise<SeededUser> {
  const seeded = await seedBaseProfile(overrides);
  await driveTransition(seeded.userId, 'email_verified');
  await driveTransition(seeded.userId, 'crp_approved');
  await driveTransition(seeded.userId, 'user_cancel');
  return seeded;
}
