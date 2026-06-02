import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  completeOnboardingImpl,
  resumeOnboardingStepImpl,
  saveOnboardingStepImpl,
  skipOnboardingImpl,
} from '@/modules/onboarding';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Section-3 step-persistence Server Actions (onboarding-wizard change):
//   * saveOnboardingStepImpl  — happy path per step, idempotency, IDOR proof,
//                               lazy checklist upsert + flag flip
//   * completeOnboardingImpl  — stamps `onboarding_completed_at`
//   * skipOnboardingImpl      — advances to 'done' WITHOUT the completion stamp,
//                               leaving checklist flags FALSE
//   * resumeOnboardingStepImpl — derives the resume segment from the persisted
//                               `onboarding_step`, never client state
//   * cross-user RLS          — user B cannot mutate user A's step (RLS backstop)
//
// The impls authenticate via a fake Supabase client (returns a fixed user) and
// write through the module-level Drizzle client (`@/shared/db/client`), which
// in the test container runs as the RLS-bypassing superuser — exactly how the
// production service-role connection behaves with ownership enforced in SQL.
// The dedicated cross-user RLS test exercises a real `authenticated`,
// session-scoped connection via `runAsUser` to prove the policy backstop.
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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof saveOnboardingStepImpl>[0];
}

async function readProfile(userId: string) {
  return runAsService(async (db) => {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return row;
  });
}

async function readChecklist(userId: string) {
  return runAsService(async (db) => {
    const [row] = await db
      .select()
      .from(onboardingChecklist)
      .where(eq(onboardingChecklist.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM onboarding_checklist
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
// saveOnboardingStepImpl
// ---------------------------------------------------------------------------

describe('saveOnboardingStepImpl', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await saveOnboardingStepImpl(fakeSupabaseClient(null), { step: 'profile' });
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('rejects an invalid step with sanitized field errors', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'billing' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('invalid_input');
  });

  it('completes the profile step: flips profile_completed and advances onboarding_step to the NEXT step (location)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'profile' });

    // The returned step is the NEXT (persisted) step, not the completed one.
    expect(result).toEqual({ ok: true, step: 'location' });

    const profile = await readProfile(userId);
    expect(profile?.onboardingStep).toBe('location');

    const checklist = await readChecklist(userId);
    expect(checklist).not.toBeNull();
    // The COMPLETED step's flag (`profile`) is flipped.
    expect(checklist!.profileCompleted).toBe(true);
    // The patients flag is untouched by the profile step.
    expect(checklist!.firstPatientAdded).toBe(false);
  });

  it('persists the typed display name to profiles.full_name when the profile payload is provided', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // The trigger seeds `full_name` from the signup metadata.
    const before = await readProfile(userId);
    expect(before?.fullName).toBe('Test Psychologist');

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), {
      step: 'profile',
      profile: { displayName: 'Dra. Marina Costa' },
    });

    expect(result).toEqual({ ok: true, step: 'location' });

    // The collected display name was written to `profiles.full_name`, not
    // silently discarded; the step still advanced.
    const after = await readProfile(userId);
    expect(after?.fullName).toBe('Dra. Marina Costa');
    expect(after?.onboardingStep).toBe('location');
  });

  it('rejects an invalid profile payload (empty display name) without advancing the step', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), {
      step: 'profile',
      profile: { displayName: '   ' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') throw new Error('expected invalid_input');
    expect(result.fieldErrors.displayName?.length).toBeGreaterThan(0);

    // Neither the name nor the step changed on a rejected payload.
    const after = await readProfile(userId);
    expect(after?.fullName).toBe('Test Psychologist');
    expect(after?.onboardingStep).toBe('welcome');
  });

  it('completes the patients step: flips first_patient_added and advances onboarding_step to the NEXT step (done)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'patients' });

    expect(result).toEqual({ ok: true, step: 'done' });

    const profile = await readProfile(userId);
    expect(profile?.onboardingStep).toBe('done');

    const checklist = await readChecklist(userId);
    expect(checklist!.firstPatientAdded).toBe(true);
    expect(checklist!.profileCompleted).toBe(false);
  });

  it('completes the location step (no dedicated flag): advances to the NEXT step (patients), ensures the checklist row exists but flips nothing', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'location' });

    expect(result).toEqual({ ok: true, step: 'patients' });

    const profile = await readProfile(userId);
    expect(profile?.onboardingStep).toBe('patients');

    const checklist = await readChecklist(userId);
    expect(checklist).not.toBeNull();
    expect(checklist!.profileCompleted).toBe(false);
    expect(checklist!.firstPatientAdded).toBe(false);
  });

  it('is idempotent — re-completing the same step preserves the flag, the advanced step, and a single row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'profile' });
    const result = await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'profile' });

    expect(result).toEqual({ ok: true, step: 'location' });

    const profile = await readProfile(userId);
    expect(profile?.onboardingStep).toBe('location');

    const rows = await runAsService(async (db) =>
      db.select().from(onboardingChecklist).where(eq(onboardingChecklist.userId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profileCompleted).toBe(true);
  });

  it('ignores a client-supplied userId — writes only the session owner row (IDOR)', async () => {
    const sessionUser = randomUUID();
    const victim = randomUUID();
    await seedAuthUser(sessionUser);
    await seedAuthUser(victim);

    // The attacker authenticates as `sessionUser` but tries to target `victim`.
    // Completing `patients` advances the session owner's step to the NEXT step
    // (`done`) and flips their patient flag — never the victim's.
    const result = await saveOnboardingStepImpl(fakeSupabaseClient(sessionUser), {
      step: 'patients',
      userId: victim,
    });

    expect(result).toEqual({ ok: true, step: 'done' });

    // The session owner's row moved and got the flag.
    const ownProfile = await readProfile(sessionUser);
    expect(ownProfile?.onboardingStep).toBe('done');
    const ownChecklist = await readChecklist(sessionUser);
    expect(ownChecklist!.firstPatientAdded).toBe(true);

    // The victim is completely untouched: step still default, no checklist row.
    const victimProfile = await readProfile(victim);
    expect(victimProfile?.onboardingStep).toBe('welcome');
    const victimChecklist = await readChecklist(victim);
    expect(victimChecklist).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// completeOnboardingImpl
// ---------------------------------------------------------------------------

describe('completeOnboardingImpl', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await completeOnboardingImpl(fakeSupabaseClient(null));
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it("sets onboarding_step='done' and stamps onboarding_completed_at", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const before = await readProfile(userId);
    expect(before?.onboardingCompletedAt).toBeNull();

    const result = await completeOnboardingImpl(fakeSupabaseClient(userId));
    expect(result).toEqual({ ok: true });

    const after = await readProfile(userId);
    expect(after?.onboardingStep).toBe('done');
    expect(after?.onboardingCompletedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// skipOnboardingImpl
// ---------------------------------------------------------------------------

describe('skipOnboardingImpl', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await skipOnboardingImpl(fakeSupabaseClient(null));
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it("advances onboarding_step to 'done' WITHOUT stamping onboarding_completed_at", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await skipOnboardingImpl(fakeSupabaseClient(userId));
    expect(result).toEqual({ ok: true });

    const after = await readProfile(userId);
    expect(after?.onboardingStep).toBe('done');
    // Completion stamp stays NULL so the checklist keeps nudging later.
    expect(after?.onboardingCompletedAt).toBeNull();
  });

  it('leaves all checklist flags FALSE (no checklist row is forced)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await skipOnboardingImpl(fakeSupabaseClient(userId));

    // Skip touches only `profiles`; it never creates or flips checklist flags.
    const checklist = await readChecklist(userId);
    expect(checklist).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resumeOnboardingStepImpl
// ---------------------------------------------------------------------------

describe('resumeOnboardingStepImpl', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await resumeOnboardingStepImpl(fakeSupabaseClient(null));
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it("maps the default 'welcome' to the first step 'profile'", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await resumeOnboardingStepImpl(fakeSupabaseClient(userId));
    expect(result).toEqual({ ok: true, resumeStep: 'profile' });
  });

  it('resumes at the persisted (advanced) step — completing profile resumes at location', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    // Completing the profile step advances the persisted step to `location`,
    // which is exactly where the user should resume.
    await saveOnboardingStepImpl(fakeSupabaseClient(userId), { step: 'profile' });

    const result = await resumeOnboardingStepImpl(fakeSupabaseClient(userId));
    expect(result).toEqual({ ok: true, resumeStep: 'location' });
  });

  it("resumes at 'done' once onboarding completed", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await completeOnboardingImpl(fakeSupabaseClient(userId));

    const result = await resumeOnboardingStepImpl(fakeSupabaseClient(userId));
    expect(result).toEqual({ ok: true, resumeStep: 'done' });
  });
});

// ---------------------------------------------------------------------------
// Cross-user RLS backstop
// ---------------------------------------------------------------------------

describe('cross-user RLS backstop', () => {
  it("user B's authenticated session cannot mutate user A's onboarding_step", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // User A completes the `location` step through the action, which advances
    // A's persisted step to the NEXT step (`patients`).
    await saveOnboardingStepImpl(fakeSupabaseClient(userA), { step: 'location' });

    // User B, on their own RLS-scoped (`authenticated`) connection, tries to
    // overwrite A's step directly. RLS USING/WITH CHECK on `profiles` restricts
    // the UPDATE to `auth.uid() = user_id`, so it matches zero rows for B.
    const updated = await runAsUser(userB, async (db) => {
      const rows = await db
        .update(profiles)
        .set({ onboardingStep: 'profile' })
        .where(eq(profiles.userId, userA))
        .returning({ userId: profiles.userId });
      return rows;
    });
    expect(updated).toHaveLength(0);

    // A's step is unchanged — the cross-tenant write never landed.
    const profileA = await readProfile(userA);
    expect(profileA?.onboardingStep).toBe('patients');
  });

  it("user B's authenticated session cannot mutate user A's checklist row", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Create A's checklist row with profile_completed = true.
    await saveOnboardingStepImpl(fakeSupabaseClient(userA), { step: 'profile' });

    const updated = await runAsUser(userB, async (db) => {
      const rows = await db
        .update(onboardingChecklist)
        .set({ profileCompleted: false })
        .where(eq(onboardingChecklist.userId, userA))
        .returning({ userId: onboardingChecklist.userId });
      return rows;
    });
    expect(updated).toHaveLength(0);

    const checklistA = await readChecklist(userA);
    expect(checklistA!.profileCompleted).toBe(true);
  });
});
