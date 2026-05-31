import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { importOnboardingPatientsImpl, quickAddOnboardingPatientImpl } from '@/modules/onboarding';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Section-7 wizard step 3 ("Importe pacientes") — server-side consent gate.
//
// Proves:
//   * the CSV import is REFUSED server-side when the psychologist has not
//     accepted the sensitive-data consent term (`sensitive_data_consent_at`
//     NULL) — the gate lives in the action, not only in the UI (RN-11.03)
//   * with consent present, the CSV import reuses the patients module, inserts
//     the rows, and flips `onboarding_checklist.first_patient_added = true`
//   * the quick-add path creates one patient and flips the same flag
//   * a client-supplied userId is ignored (IDOR)
//   * cross-user RLS holds: user B cannot flip user A's `first_patient_added`
//
// The impl authenticates via a fake Supabase client and writes through the
// module-level Drizzle client (RLS-bypassing superuser in the test container),
// exactly how the production service-role connection behaves with ownership
// enforced in SQL. The cross-user RLS test uses a real `authenticated`,
// session-scoped connection via `runAsUser`.
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Test Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    // Signup always stamps consent — the `handle_new_user` trigger requires it.
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

// Simulate an LGPD consent WITHDRAWAL: clear the timestamp back to NULL. Only
// possible because migration 0037 relaxed the NOT NULL constraint.
async function withdrawSensitiveDataConsent(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db
      .update(profiles)
      .set({ sensitiveDataConsentAt: null })
      .where(eq(profiles.userId, userId));
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
  } as Parameters<typeof importOnboardingPatientsImpl>[0];
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

async function readPatients(userId: string) {
  return runAsService(async (db) => db.select().from(patients).where(eq(patients.userId, userId)));
}

async function readProfile(userId: string) {
  return runAsService(async (db) => {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return row;
  });
}

const ONE_VALID_ROW = [{ fullName: 'Maria Souza', phone: null, email: null }];

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM patients
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
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

describe('importOnboardingPatientsImpl — sensitive-data consent gate (wizard step 3)', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await importOnboardingPatientsImpl(fakeSupabaseClient(null), ONE_VALID_ROW);
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('blocks the import SERVER-side when sensitive_data_consent_at is NULL', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await withdrawSensitiveDataConsent(userId);

    const result = await importOnboardingPatientsImpl(fakeSupabaseClient(userId), ONE_VALID_ROW);

    expect(result).toEqual({ ok: false, error: 'consent_required' });

    // Nothing was ingested and the flag was NOT flipped.
    expect(await readPatients(userId)).toHaveLength(0);
    expect(await readChecklist(userId)).toBeNull();
  });

  it('imports rows and flips first_patient_added when consent is present', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await importOnboardingPatientsImpl(fakeSupabaseClient(userId), [
      { fullName: 'Maria Souza', phone: null, email: null },
      { fullName: 'João Lima', phone: null, email: null },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.importedCount).toBe(2);

    // The patients persisted into the EXISTING patients table.
    const rows = await readPatients(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === userId)).toBe(true);
    expect(rows.every((r) => r.patientType === 'adult')).toBe(true);

    // The checklist flag flipped + step advanced.
    const checklist = await readChecklist(userId);
    expect(checklist).not.toBeNull();
    expect(checklist!.firstPatientAdded).toBe(true);
    expect(checklist!.locationConfigured).toBe(false);
    expect((await readProfile(userId))?.onboardingStep).toBe('patients');
  });
});

describe('quickAddOnboardingPatientImpl (wizard step 3)', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await quickAddOnboardingPatientImpl(fakeSupabaseClient(null), {
      fullName: 'Maria Souza',
      patientType: 'individual',
    });
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('creating one patient flips first_patient_added and advances the step', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await quickAddOnboardingPatientImpl(fakeSupabaseClient(userId), {
      fullName: 'Maria Souza',
      patientType: 'individual',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(typeof result.patientId).toBe('string');

    const rows = await readPatients(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Maria Souza');

    const checklist = await readChecklist(userId);
    expect(checklist!.firstPatientAdded).toBe(true);
    expect((await readProfile(userId))?.onboardingStep).toBe('patients');
  });

  it('quick-add is NOT gated by consent — it creates one patient via the standard path', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await withdrawSensitiveDataConsent(userId);

    const result = await quickAddOnboardingPatientImpl(fakeSupabaseClient(userId), {
      fullName: 'Maria Souza',
      patientType: 'individual',
    });

    expect(result.ok).toBe(true);
    expect(await readPatients(userId)).toHaveLength(1);
    expect((await readChecklist(userId))!.firstPatientAdded).toBe(true);
  });

  it('ignores a client-supplied userId — writes only the session owner rows (IDOR)', async () => {
    const sessionUser = randomUUID();
    const victim = randomUUID();
    await seedAuthUser(sessionUser);
    await seedAuthUser(victim);

    const result = await quickAddOnboardingPatientImpl(fakeSupabaseClient(sessionUser), {
      fullName: 'Maria Souza',
      patientType: 'individual',
      // Attacker-supplied field; the impl never reads it.
      ...({ userId: victim } as Record<string, unknown>),
    });

    expect(result.ok).toBe(true);

    expect(await readPatients(sessionUser)).toHaveLength(1);
    expect((await readChecklist(sessionUser))!.firstPatientAdded).toBe(true);

    // The victim is completely untouched.
    expect(await readPatients(victim)).toHaveLength(0);
    expect(await readChecklist(victim)).toBeNull();
    expect((await readProfile(victim))?.onboardingStep).toBe('welcome');
  });
});

describe('cross-user RLS backstop (wizard step 3)', () => {
  it("user B cannot flip user A's first_patient_added", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // A completes step 3 → A's checklist row has first_patient_added = true.
    await quickAddOnboardingPatientImpl(fakeSupabaseClient(userA), {
      fullName: 'Paciente A',
      patientType: 'individual',
    });

    // B, on a real authenticated/RLS-scoped connection, tries to clear A's flag.
    const updated = await runAsUser(userB, async (db) => {
      return db
        .update(onboardingChecklist)
        .set({ firstPatientAdded: false })
        .where(eq(onboardingChecklist.userId, userA))
        .returning({ userId: onboardingChecklist.userId });
    });
    expect(updated).toHaveLength(0);

    // A's flag is unchanged.
    expect((await readChecklist(userA))!.firstPatientAdded).toBe(true);

    // B also cannot READ A's patients across the RLS boundary.
    const visibleToB = await runAsUser(userB, async (db) =>
      db
        .select()
        .from(patients)
        .where(and(eq(patients.userId, userA))),
    );
    expect(visibleToB).toHaveLength(0);
  });
});
