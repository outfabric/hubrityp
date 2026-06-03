import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { recomputeChecklistImpl } from '@/modules/onboarding';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// recomputeChecklistImpl — real Postgres (Testcontainers)
//
// Proves the section-1 recompute contract:
//   * each item is derived from authoritative data, not a stale flag
//   * creating a non-cancelled session flips first_session_scheduled
//   * a patient with consent_signed_at flips first_consent_sent
//   * the bonus needs AI enabled AND >= 1 transcription
//   * owner-scoping: user B's data never satisfies user A's items
//   * the persisted row's user_id is always the session uid (no client id can
//     redirect the write to another account)
//   * cross-user RLS holds: a user can never read another user's checklist row
// ---------------------------------------------------------------------------

// `handle_new_user()` (SECURITY DEFINER trigger) materializes `public.profiles`
// from `raw_user_meta_data`, so the metadata it requires MUST be present. We
// pass through optional `emailVerifiedAt` / `crpValidatedAt` overrides so a test
// can make `cadastro_completo` true.
async function seedAuthUser(
  userId: string,
  opts: { emailVerified?: boolean; crpValidated?: boolean } = {},
): Promise<void> {
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
    if (opts.emailVerified) {
      await db.execute(
        dsql`UPDATE profiles SET email_verified_at = now() WHERE user_id = ${userId}`,
      );
    }
    if (opts.crpValidated) {
      await db.execute(
        dsql`UPDATE profiles SET crp_validated_at = now() WHERE user_id = ${userId}`,
      );
    }
  });
}

async function seedLocation(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(locations).values({ userId, name: 'Consultório', type: 'in_person' });
  });
}

async function seedPatient(
  userId: string,
  opts: { status?: string; consentSignedAt?: Date | null } = {},
): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id,
      userId,
      fullName: 'Test Patient',
      status: opts.status ?? 'active',
      consentSignedAt: opts.consentSignedAt ?? null,
    });
  });
  return id;
}

async function seedSession(userId: string, patientId: string, status: string): Promise<string> {
  const id = randomUUID();
  const startAt = new Date();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId,
      patientId,
      startAt,
      endAt: new Date(startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      status,
    });
  });
  return id;
}

async function seedEvolution(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      id: randomUUID(),
      userId,
      patientId,
      sessionId,
      templateType: 'livre',
      content: { text: 'evolution' },
    });
  });
}

async function seedAiSettings(userId: string, enabled: boolean): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptionSettings).values({ userId, enabled });
  });
}

async function seedTranscription(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: randomUUID(),
      userId,
      patientId,
      source: 'manual_upload',
      status: 'pending',
    });
  });
}

async function readChecklistRow(userId: string) {
  return runAsService(async (db) => {
    const rows = await db
      .select()
      .from(onboardingChecklist)
      .where(eq(onboardingChecklist.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof recomputeChecklistImpl>[0];
}

// `recomputeChecklistImpl` is wrapped in React `cache()`. `cache` memoizes only
// within a React render / `cache` scope; in plain Vitest there is no active
// scope, so each call re-executes. We still seed distinct users per test to be
// robust against any cross-call memoization.

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('recomputeChecklistImpl — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await recomputeChecklistImpl(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('persists an all-false row for a brand-new user with no data', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual({
      cadastro_completo: false,
      perfil_e_local: false,
      primeiro_paciente: false,
      primeira_sessao: false,
      primeira_evolucao: false,
      primeiro_termo: false,
      transcricao_ia: false,
    });

    const row = await readChecklistRow(userId);
    expect(row).not.toBeNull();
    expect(row!.firstSessionScheduled).toBe(false);
    expect(row!.firstConsentSent).toBe(false);
  });

  it('flips first_session_scheduled when a non-cancelled session exists', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId);

    // Before: no session.
    let result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok && result.state.primeira_sessao).toBe(false);

    await seedSession(userId, patientId, 'scheduled');

    result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.primeira_sessao).toBe(true);

    const row = await readChecklistRow(userId);
    expect(row!.firstSessionScheduled).toBe(true);
  });

  it('does NOT flip first_session_scheduled when the only session is cancelled', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId);
    await seedSession(userId, patientId, 'cancelled');

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.primeira_sessao).toBe(false);
  });

  it('flips first_consent_sent when a patient has consent_signed_at', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Active patient WITHOUT consent → primeiro_paciente true, primeiro_termo false.
    await seedPatient(userId, { consentSignedAt: null });

    let result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.primeiro_paciente).toBe(true);
    expect(result.state.primeiro_termo).toBe(false);

    // Add a patient WITH consent.
    await seedPatient(userId, { consentSignedAt: new Date() });

    result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.primeiro_termo).toBe(true);

    const row = await readChecklistRow(userId);
    expect(row!.firstConsentSent).toBe(true);
  });

  it('flips primeira_evolucao when an evolution exists', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId);
    const sessionId = await seedSession(userId, patientId, 'done');
    await seedEvolution(userId, patientId, sessionId);

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.primeira_evolucao).toBe(true);
    expect((await readChecklistRow(userId))!.firstEvolutionRecorded).toBe(true);
  });

  it('flips perfil_e_local when a location exists', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedLocation(userId);

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.perfil_e_local).toBe(true);
  });

  it('flips cadastro_completo only when email verified AND CRP validated', async () => {
    // Only email verified → still false.
    const userEmailOnly = randomUUID();
    await seedAuthUser(userEmailOnly, { emailVerified: true });
    let result = await recomputeChecklistImpl(fakeSupabaseClient(userEmailOnly));
    expect(result.ok && result.state.cadastro_completo).toBe(false);

    // Both verified → true.
    const userBoth = randomUUID();
    await seedAuthUser(userBoth, { emailVerified: true, crpValidated: true });
    result = await recomputeChecklistImpl(fakeSupabaseClient(userBoth));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cadastro_completo).toBe(true);
  });

  it('treats the AI bonus as done only when enabled AND a transcription exists', async () => {
    // Enabled but no transcription → false.
    const userEnabledOnly = randomUUID();
    await seedAuthUser(userEnabledOnly);
    await seedAiSettings(userEnabledOnly, true);
    let result = await recomputeChecklistImpl(fakeSupabaseClient(userEnabledOnly));
    expect(result.ok && result.state.transcricao_ia).toBe(false);

    // Transcription exists but disabled → false.
    const userDisabled = randomUUID();
    await seedAuthUser(userDisabled);
    const pDisabled = await seedPatient(userDisabled);
    await seedAiSettings(userDisabled, false);
    await seedTranscription(userDisabled, pDisabled);
    result = await recomputeChecklistImpl(fakeSupabaseClient(userDisabled));
    expect(result.ok && result.state.transcricao_ia).toBe(false);

    // Enabled AND transcription → true.
    const userBoth = randomUUID();
    await seedAuthUser(userBoth);
    const pBoth = await seedPatient(userBoth);
    await seedAiSettings(userBoth, true);
    await seedTranscription(userBoth, pBoth);
    result = await recomputeChecklistImpl(fakeSupabaseClient(userBoth));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.transcricao_ia).toBe(true);
    expect((await readChecklistRow(userBoth))!.aiTranscriptionTried).toBe(true);
  });

  it("is owner-scoped: user B's data never satisfies user A's items", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // ALL of B's data — none should bleed into A's recompute.
    const patientB = await seedPatient(userB, { consentSignedAt: new Date() });
    await seedLocation(userB);
    await seedSession(userB, patientB, 'scheduled');

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual({
      cadastro_completo: false,
      perfil_e_local: false,
      primeiro_paciente: false,
      primeira_sessao: false,
      primeira_evolucao: false,
      primeiro_termo: false,
      transcricao_ia: false,
    });

    // A's persisted row stays all-false; B's recompute writes only B's row.
    const resultB = await recomputeChecklistImpl(fakeSupabaseClient(userB));
    expect(resultB.ok && resultB.state.primeiro_termo).toBe(true);

    const rowA = await readChecklistRow(userA);
    expect(rowA!.firstConsentSent).toBe(false);
    expect(rowA!.firstSessionScheduled).toBe(false);
  });

  it('writes only the session uid row, never another account (client id is irrelevant)', async () => {
    // The function takes no payload, so there is no client userId to honor —
    // the only thing that decides the written row is the authenticated session.
    // Authenticating as B persists B's row; A's row is untouched / absent.
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedLocation(userB);

    const result = await recomputeChecklistImpl(fakeSupabaseClient(userB));
    expect(result.ok).toBe(true);

    const rowB = await readChecklistRow(userB);
    expect(rowB).not.toBeNull();
    expect(rowB!.userId).toBe(userB);

    const rowA = await readChecklistRow(userA);
    expect(rowA).toBeNull();
  });

  it("enforces cross-user RLS: a user cannot read another user's checklist row", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Materialize A's checklist row via recompute.
    await recomputeChecklistImpl(fakeSupabaseClient(userA));

    // Under B's RLS-scoped connection, A's row must be invisible. We import the
    // per-user transaction helper lazily to keep the happy-path tests fast.
    const { runAsUser } = await import('../setup/run-as-user');
    const visibleToB = await runAsUser(userB, async (db) => {
      const rows = await db
        .select()
        .from(onboardingChecklist)
        .where(eq(onboardingChecklist.userId, userA))
        .limit(1);
      return rows[0] ?? null;
    });
    expect(visibleToB).toBeNull();

    // Sanity: A sees A's own row under A's RLS connection.
    const visibleToA = await runAsUser(userA, async (db) => {
      const rows = await db
        .select()
        .from(onboardingChecklist)
        .where(eq(onboardingChecklist.userId, userA))
        .limit(1);
      return rows[0] ?? null;
    });
    expect(visibleToA).not.toBeNull();
  });
});
