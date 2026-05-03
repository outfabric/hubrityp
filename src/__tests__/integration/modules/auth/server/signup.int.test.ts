import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// We mock both Supabase client surfaces (anon-key server client used to call
// `auth.signUp` and admin client used for `auth.admin.deleteUser`) so each
// scenario can stage exact responses without booting GoTrue. The action
// itself runs unmocked against the real Postgres test container — the DB
// assertions are what matter.

const signUpMock = vi.fn();
const adminDeleteUserMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: signUpMock,
    },
  }),
}));

vi.mock('@/shared/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        deleteUser: adminDeleteUserMock,
      },
    },
  })),
}));

// Logger spy: integration globalSetup sets LOG_LEVEL=silent so a real pino
// logger swallows calls; spy mocks let us assert whether
// `signup_succeeded`/`signup_failed` lines fire on each branch.
const warnSpy = vi.fn();
const errorSpy = vi.fn();
const infoSpy = vi.fn();
const debugSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: (...args: unknown[]): void => {
      errorSpy(...args);
    },
    info: (...args: unknown[]): void => {
      infoSpy(...args);
    },
    debug: (...args: unknown[]): void => {
      debugSpy(...args);
    },
  },
  redactPaths: [],
}));

// Seed a row in the bootstrap-stub `auth.users` table so the FK from
// `psychologist_profiles.user_id` resolves for tests that DON'T go through
// the real signUp flow (we mock that). The action inserts profile/queue
// rows — those FKs need a target row.
async function seedAuthUser(userId: string, email: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

const validInput = {
  fullName: 'Ana Silva',
  email: 'ana@example.com',
  password: 'Senha!Forte9',
  passwordConfirm: 'Senha!Forte9',
  crpNumber: '06/123456',
  crpUf: 'SP',
  acceptedTerms: true,
  acceptedPrivacy: true,
  acceptedSensitiveData: true,
} as const;

beforeEach(() => {
  signUpMock.mockReset();
  adminDeleteUserMock.mockReset();
  warnSpy.mockReset();
  errorSpy.mockReset();
  infoSpy.mockReset();
  debugSpy.mockReset();
});

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(authResendLog);
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
  vi.resetModules();
});

describe('signUpImpl (integration)', () => {
  it('creates the Supabase user, profile, and queue row on a valid signup', async () => {
    const userId = randomUUID();
    // Pre-create the auth.users row before the action runs, since signUp is
    // mocked. This mirrors what the real GoTrue flow would do.
    await seedAuthUser(userId, validInput.email);
    signUpMock.mockResolvedValue({
      data: { user: { id: userId, email: validInput.email } },
      error: null,
    });

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: true, redirectTo: '/auth/verify-email' });

    const profileRows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profileRows).toHaveLength(1);
    const profile = profileRows[0]!;
    expect(profile.status).toBe('pending_verification');
    expect(profile.fullName).toBe(validInput.fullName);
    expect(profile.crpNumber).toBe(validInput.crpNumber);
    expect(profile.crpUf).toBe(validInput.crpUf);
    expect(profile.termsVersion).toBe('2026-05');
    expect(profile.privacyVersion).toBe('2026-05');
    expect(profile.sensitiveDataConsentVersion).toBe('2026-05');

    // Spec: "three consent timestamps set to NOW()". They MUST all be within
    // a small window (here, ≤1s) of each other. We don't pin to literal
    // `NOW()` because the action's `new Date()` runs slightly before the
    // INSERT; what matters is that all three are stamped together.
    const t = profile.termsAcceptedAt.getTime();
    const p = profile.privacyAcceptedAt.getTime();
    const s = profile.sensitiveDataConsentAt.getTime();
    expect(Math.abs(t - p)).toBeLessThan(1000);
    expect(Math.abs(t - s)).toBeLessThan(1000);

    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.userId, userId)),
    );
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0]?.status).toBe('pending');
    expect(queueRows[0]?.crpNumber).toBe(validInput.crpNumber);
    expect(queueRows[0]?.crpUf).toBe(validInput.crpUf);

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(signUpMock).toHaveBeenCalledWith({
      email: validInput.email,
      password: validInput.password,
    });
    // Compensating delete MUST NOT have fired on the success path.
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('lower-cases the email before persistence', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId, 'mixed@example.com');
    signUpMock.mockResolvedValue({
      data: { user: { id: userId, email: 'mixed@example.com' } },
      error: null,
    });

    const { signUp } = await import('@/modules/auth');
    await signUp({ ...validInput, email: 'Mixed@EXAMPLE.com' });

    expect(signUpMock).toHaveBeenCalledWith({
      email: 'mixed@example.com',
      password: validInput.password,
    });
  });

  it('returns email_already_registered when Supabase signals duplicate email', async () => {
    signUpMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'User already registered' },
    });

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: false, error: 'email_already_registered' });

    // No profile or queue rows were inserted.
    const profileCount = await runAsService(async (db) => db.select().from(psychologistProfiles));
    expect(profileCount).toHaveLength(0);
    const queueCount = await runAsService(async (db) => db.select().from(crpValidationQueue));
    expect(queueCount).toHaveLength(0);
    // Compensating delete MUST NOT have fired — the user was never created.
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('returns crp_already_registered (pre-flight) without creating a Supabase user', async () => {
    // Seed an existing profile holding the same CRP+UF the test will submit.
    const existingUserId = randomUUID();
    await seedAuthUser(existingUserId, 'already@example.com');
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values({
        userId: existingUserId,
        fullName: 'Existing',
        crpNumber: '06/123456',
        crpUf: 'SP',
        status: 'active',
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
        sensitiveDataConsentAt: new Date(),
        termsVersion: '2026-05',
        privacyVersion: '2026-05',
        sensitiveDataConsentVersion: '2026-05',
      });
    });

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: false, error: 'crp_already_registered' });
    // Pre-flight short-circuit: the action MUST NOT have called Supabase.
    expect(signUpMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('returns crp_already_registered (race path) and compensating-deletes the Supabase user', async () => {
    // Two parallel signups race on the same CRP. We simulate that by
    // (a) mocking signUp to succeed (returning a fresh user id) and
    // (b) staging a pre-existing profile row that the pre-flight does NOT
    //     see — we need to insert it AFTER the pre-flight runs but BEFORE
    //     the transaction tries to insert.
    //
    // Trick: the pre-flight is just a SELECT. We dynamically intercept
    // `signUpMock` so that *during* its mocked call we insert the
    // conflicting row, simulating the lost-race. By the time the
    // transaction runs, the UNIQUE constraint will fire.
    const conflictUserId = randomUUID();
    const newUserId = randomUUID();
    await seedAuthUser(conflictUserId, 'conflict@example.com');
    await seedAuthUser(newUserId, validInput.email);

    signUpMock.mockImplementation(async () => {
      await runAsService(async (db) => {
        await db.insert(psychologistProfiles).values({
          userId: conflictUserId,
          fullName: 'Race Winner',
          crpNumber: '06/123456',
          crpUf: 'SP',
          status: 'active',
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
          sensitiveDataConsentAt: new Date(),
          termsVersion: '2026-05',
          privacyVersion: '2026-05',
          sensitiveDataConsentVersion: '2026-05',
        });
      });
      return {
        data: { user: { id: newUserId, email: validInput.email } },
        error: null,
      };
    });
    adminDeleteUserMock.mockResolvedValue({ data: null, error: null });

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: false, error: 'crp_already_registered' });
    // Compensating delete MUST have run for the freshly-created user.
    expect(adminDeleteUserMock).toHaveBeenCalledTimes(1);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(newUserId);

    // The losing-race profile MUST NOT exist.
    const newProfile = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, newUserId)),
    );
    expect(newProfile).toHaveLength(0);

    // The conflicting row stays — the race winner keeps their profile.
    const conflict = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, conflictUserId)),
    );
    expect(conflict).toHaveLength(1);
  });

  it('rejects validation errors before any Supabase or DB call', async () => {
    const { signUp } = await import('@/modules/auth');
    const result = await signUp({
      ...validInput,
      // Missing the special-character class.
      password: 'SenhaForte9',
      passwordConfirm: 'SenhaForte9',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_failed');
    expect(result.fieldErrors?.password).toBeDefined();
    expect(result.fieldErrors?.password?.toLowerCase()).toContain('especial');

    // Crucial: NEITHER mock was invoked. This guarantees the schema
    // short-circuit ran before any network hop.
    expect(signUpMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();

    // Likewise: no DB rows were written.
    const profileCount = await runAsService(async (db) => db.select().from(psychologistProfiles));
    expect(profileCount).toHaveLength(0);
  });

  it('returns unknown and compensating-deletes when the transaction fails for any other reason', async () => {
    // Force the transaction to fail by returning a userId whose auth.users
    // row does NOT exist. Inserting into psychologist_profiles will violate
    // the FK (`23503`, `foreign_key_violation`) — a different error code
    // than UNIQUE — so the action must return `unknown`, not
    // `crp_already_registered`.
    const orphanUserId = randomUUID();
    signUpMock.mockResolvedValue({
      data: { user: { id: orphanUserId, email: validInput.email } },
      error: null,
    });
    adminDeleteUserMock.mockResolvedValue({ data: null, error: null });

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(adminDeleteUserMock).toHaveBeenCalledTimes(1);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(orphanUserId);
  });

  it('never throws across the boundary — even when Supabase signUp throws', async () => {
    signUpMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('never throws across the boundary — even when the compensating delete itself throws', async () => {
    const orphanUserId = randomUUID();
    signUpMock.mockResolvedValue({
      data: { user: { id: orphanUserId, email: validInput.email } },
      error: null,
    });
    // Simulate the compensating delete failing (e.g. admin API down).
    adminDeleteUserMock.mockRejectedValue(new Error('admin API unreachable'));

    const { signUp } = await import('@/modules/auth');
    const result = await signUp({ ...validInput });

    // The transaction failed (FK violation), the compensating delete
    // failed too, and the action STILL returns a typed error rather than
    // throwing.
    expect(result).toEqual({ ok: false, error: 'unknown' });
  });
});
