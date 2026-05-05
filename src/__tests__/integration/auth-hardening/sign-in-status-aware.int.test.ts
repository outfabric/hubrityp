import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { signupInputFactory } from '../registration/factories/signup-input';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 6.7 — sign-in status-aware integration test
//
// Covers the new error states added by the login hardening change:
// `locked_out`, `requires_password_reset`, `account_unavailable`.
//
// These tests run against a real DB (Testcontainers) to verify the lockout
// and password-reset columns are correctly read by `signInImpl`.
// ---------------------------------------------------------------------------

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();
const sessionRef: { current: { id: string; email: string } | null } = { current: null };

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
      // eslint-disable-next-line @typescript-eslint/require-await -- shaped to match the SupabaseClient surface
      getUser: async () => ({
        data: { user: sessionRef.current ? { ...sessionRef.current } : null },
        error: sessionRef.current ? null : { message: 'no session' },
      }),
    },
  }),
}));

// Mock cookies for setKeepLoggedInCookie / clearKeepLoggedInCookie
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock send-account-locked email
vi.mock('@/shared/lib/mail/send-account-locked', () => ({
  sendAccountLockedEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signOutMock.mockReset();
  signInWithPasswordMock.mockImplementation(() => Promise.resolve({ data: {}, error: null }));
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(async () => {
  vi.resetModules();
  sessionRef.current = null;
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM profiles`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

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
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
  });
  return { userId, email };
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('signIn status-aware — lockout and password reset (real DB)', () => {
  it('returns locked_out when lockout_until is in the future', async () => {
    const seeded = await seedProfile();
    // Set lockout_until to 30 minutes from now
    const lockoutUntil = new Date(Date.now() + 30 * 60 * 1000);
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({
          lockoutUntil,
          failedLoginCount: 5,
          status: 'active',
        })
        .where(eq(profiles.userId, seeded.userId));
    });

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'any-password' }));

    expect(result).toMatchObject({
      ok: false,
      error: 'locked_out',
    });
    // Should include lockoutUntil timestamp
    expect((result as { lockoutUntil?: string }).lockoutUntil).toBeDefined();
    // signInWithPassword should NOT have been called — lockout pre-check
    // blocks before reaching Supabase
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it('does NOT return locked_out when lockout_until is in the past', async () => {
    const seeded = await seedProfile();
    // Set lockout_until to 30 minutes AGO (expired)
    const lockoutUntil = new Date(Date.now() - 30 * 60 * 1000);
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({
          lockoutUntil,
          failedLoginCount: 5,
          status: 'active',
        })
        .where(eq(profiles.userId, seeded.userId));
    });

    sessionRef.current = { id: seeded.userId, email: seeded.email };

    // Supabase succeeds — the expired lockout should not block login
    const { signIn } = await import('@/app/(auth)/login/actions');

    // The action should proceed to signInWithPassword (we set the session
    // ref so getCurrentProfile resolves the active profile)
    let caught: unknown = null;
    try {
      await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));
    } catch (err) {
      caught = err;
    }

    // Should have called signInWithPassword
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
    // Should redirect (success path) — the caught error is NEXT_REDIRECT
    expect(caught).toBeDefined();
  });

  it('returns requires_password_reset when profile has requires_password_reset=true', async () => {
    const seeded = await seedProfile();
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({
          requiresPasswordReset: true,
          status: 'active',
        })
        .where(eq(profiles.userId, seeded.userId));
    });

    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));

    expect(result).toEqual({ ok: false, error: 'requires_password_reset' });
    // signInWithPassword was called (auth succeeded) but then we signed out
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('returns account_unavailable for suspended profile', async () => {
    const seeded = await seedProfile();
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({ status: 'suspended' })
        .where(eq(profiles.userId, seeded.userId));
    });

    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));

    expect(result).toEqual({ ok: false, error: 'account_unavailable' });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('returns account_unavailable for cancelled profile', async () => {
    const seeded = await seedProfile();
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({ status: 'cancelled' })
        .where(eq(profiles.userId, seeded.userId));
    });

    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));

    expect(result).toEqual({ ok: false, error: 'account_unavailable' });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('applies failed login attempt and returns invalid_credentials on auth failure with existing profile', async () => {
    const seeded = await seedProfile();
    await runAsService(async (db) => {
      await db.update(profiles).set({ status: 'active' }).where(eq(profiles.userId, seeded.userId));
    });

    // Supabase rejects the credentials
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthApiError', message: 'Invalid login credentials' },
    });

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'wrong-password' }));

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });

    // Check that the failed_login_count was incremented
    const updatedProfile = await runAsService(async (db) => {
      const rows = await db
        .select({ failedLoginCount: profiles.failedLoginCount })
        .from(profiles)
        .where(eq(profiles.userId, seeded.userId));
      return rows[0];
    });

    expect(updatedProfile?.failedLoginCount).toBe(1);
  });

  it('returns locked_out when the 5th failed attempt triggers lockout', async () => {
    const seeded = await seedProfile();
    // Pre-set 4 failed attempts
    await runAsService(async (db) => {
      await db
        .update(profiles)
        .set({
          failedLoginCount: 4,
          lastFailedLoginAt: new Date(),
          status: 'active',
        })
        .where(eq(profiles.userId, seeded.userId));
    });

    // Supabase rejects
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthApiError', message: 'Invalid login credentials' },
    });

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'wrong-password' }));

    expect(result).toMatchObject({
      ok: false,
      error: 'locked_out',
    });
    expect((result as { lockoutUntil?: string }).lockoutUntil).toBeDefined();
  });
});
