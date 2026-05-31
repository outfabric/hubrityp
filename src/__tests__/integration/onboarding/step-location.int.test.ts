import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { configureLocationImpl } from '@/modules/onboarding';
import { agendaSettings, locations } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Section-6 wizard step 2 ("Local e agenda") — configureLocationImpl.
//
// Proves the step REUSES the existing agenda `locations` / `agenda_settings`
// tables (no onboarding-specific location table) and that adding the first
// location flips `onboarding_checklist.location_configured = true`:
//   * unauthenticated callers are rejected
//   * invalid location input is rejected with sanitized field errors
//   * the happy path inserts ONE `locations` row, ensures an `agenda_settings`
//     row exists with the table defaults (50 min / 10 min), flips the flag,
//     and advances `profiles.onboarding_step` to 'location'
//   * the flow is idempotent-friendly: a second location keeps the flag TRUE
//     and does not create a duplicate checklist/settings row
//   * a client-supplied userId is ignored (IDOR), and a cross-user write is
//     blocked by RLS (backstop)
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
  } as Parameters<typeof configureLocationImpl>[0];
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

async function readLocations(userId: string) {
  return runAsService(async (db) =>
    db.select().from(locations).where(eq(locations.userId, userId)),
  );
}

async function readAgendaSettings(userId: string) {
  return runAsService(async (db) => {
    const [row] = await db
      .select()
      .from(agendaSettings)
      .where(eq(agendaSettings.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    // Children of test auth.users — clean up before deleting the users.
    await db.execute(
      dsql`DELETE FROM locations
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM agenda_settings
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

describe('configureLocationImpl (wizard step 2)', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await configureLocationImpl(fakeSupabaseClient(null), {
      name: 'Consultório Vila Madalena',
      type: 'in_person',
    });
    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('rejects invalid location input with sanitized field errors', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Missing `name` (required) → the agenda location schema rejects it.
    const result = await configureLocationImpl(fakeSupabaseClient(userId), {
      type: 'in_person',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('invalid_input');

    // Nothing was persisted on the rejected path.
    expect(await readLocations(userId)).toHaveLength(0);
    expect(await readChecklist(userId)).toBeNull();
  });

  it('adding the first location flips location_configured and reuses the existing locations table', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await configureLocationImpl(fakeSupabaseClient(userId), {
      name: 'Consultório Vila Madalena',
      type: 'in_person',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(typeof result.locationId).toBe('string');

    // The location persisted into the EXISTING agenda `locations` table.
    const rows = await readLocations(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Consultório Vila Madalena');
    expect(rows[0]!.userId).toBe(userId);

    // The checklist flag flipped.
    const checklist = await readChecklist(userId);
    expect(checklist).not.toBeNull();
    expect(checklist!.locationConfigured).toBe(true);
    // Unrelated flags stay FALSE.
    expect(checklist!.profileCompleted).toBe(false);
    expect(checklist!.firstPatientAdded).toBe(false);

    // The wizard step advanced.
    const profile = await readProfile(userId);
    expect(profile?.onboardingStep).toBe('location');

    // An agenda_settings row now exists with the table defaults (50 / 10).
    const settings = await readAgendaSettings(userId);
    expect(settings).not.toBeNull();
    expect(settings!.defaultDurationMinutes).toBe(50);
    expect(settings!.intervalMinutes).toBe(10);
  });

  it('adding a second location keeps the flag TRUE without duplicating singleton rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await configureLocationImpl(fakeSupabaseClient(userId), {
      name: 'Consultório Vila Madalena',
      type: 'in_person',
    });
    const second = await configureLocationImpl(fakeSupabaseClient(userId), {
      name: 'Atendimento Online',
      type: 'online',
    });

    expect(second.ok).toBe(true);

    // Two locations, but exactly one checklist row and one settings row.
    expect(await readLocations(userId)).toHaveLength(2);

    const checklistRows = await runAsService(async (db) =>
      db.select().from(onboardingChecklist).where(eq(onboardingChecklist.userId, userId)),
    );
    expect(checklistRows).toHaveLength(1);
    expect(checklistRows[0]!.locationConfigured).toBe(true);

    const settingsRows = await runAsService(async (db) =>
      db.select().from(agendaSettings).where(eq(agendaSettings.userId, userId)),
    );
    expect(settingsRows).toHaveLength(1);
  });

  it('ignores a client-supplied userId — writes only the session owner rows (IDOR)', async () => {
    const sessionUser = randomUUID();
    const victim = randomUUID();
    await seedAuthUser(sessionUser);
    await seedAuthUser(victim);

    const result = await configureLocationImpl(fakeSupabaseClient(sessionUser), {
      name: 'Consultório Vila Madalena',
      type: 'in_person',
      // Attacker-supplied field; the impl never reads it.
      ...({ userId: victim } as Record<string, unknown>),
    });

    expect(result.ok).toBe(true);

    // The session owner got the location + flag.
    expect(await readLocations(sessionUser)).toHaveLength(1);
    expect((await readChecklist(sessionUser))!.locationConfigured).toBe(true);

    // The victim is completely untouched.
    expect(await readLocations(victim)).toHaveLength(0);
    expect(await readChecklist(victim)).toBeNull();
    expect((await readProfile(victim))?.onboardingStep).toBe('welcome');
  });

  it("cross-user RLS backstop: user B cannot flip user A's location_configured", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // A completes step 2 → A's checklist row has location_configured = true.
    await configureLocationImpl(fakeSupabaseClient(userA), {
      name: 'Consultório A',
      type: 'in_person',
    });

    // B, on a real authenticated/RLS-scoped connection, tries to clear A's flag.
    const updated = await runAsUser(userB, async (db) => {
      return db
        .update(onboardingChecklist)
        .set({ locationConfigured: false })
        .where(eq(onboardingChecklist.userId, userA))
        .returning({ userId: onboardingChecklist.userId });
    });
    expect(updated).toHaveLength(0);

    // A's flag is unchanged.
    expect((await readChecklist(userA))!.locationConfigured).toBe(true);
  });
});
