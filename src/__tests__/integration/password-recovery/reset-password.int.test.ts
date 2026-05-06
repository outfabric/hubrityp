import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 7.7 — Integration tests for resetPassword
//
// Tests:
//   - Happy path: updates password, revokes all sessions, resets lockout
//     state, sendPasswordChangedEmail invoked, redirects to
//     /login?banner=password_changed
//   - Weak password: rejected by Zod schema
//   - No session: returns { ok: false, error: 'invalid_session' }
// ---------------------------------------------------------------------------

const updateUserMock = vi.fn();
const getUserMock = vi.fn();
const adminSignOutMock = vi.fn();
const sendPasswordChangedEmailMock = vi.fn();

const SEED_USER_ID = randomUUID();
const SEED_EMAIL = `reset-${SEED_USER_ID.slice(0, 8)}@test.local`;

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: getUserMock,
      updateUser: updateUserMock,
    },
  }),
}));

// Mock the admin client (createClient from @supabase/supabase-js)
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      admin: {
        signOut: adminSignOutMock,
      },
    },
  }),
}));

vi.mock('@/shared/lib/mail/send-password-changed', () => ({
  sendPasswordChangedEmail: sendPasswordChangedEmailMock,
}));

// Mock logAuthEvent to avoid DB writes during tests
vi.mock('@/modules/registration/server/log-auth-event', () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock next/navigation redirect — it throws a NEXT_REDIRECT marker
const redirectMock = vi.fn().mockImplementation((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  err.name = 'NEXT_REDIRECT';
  throw err;
});
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

afterEach(async () => {
  vi.clearAllMocks();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM profiles`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const STRONG_PASSWORD = 'MyStr0ng!Pass99';

async function seedUser(): Promise<void> {
  await runAsService(async (db) => {
    // Use provider:"google" so handle_new_user trigger skips auto-profile
    // creation — we insert the profile manually to control its initial state.
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${SEED_USER_ID}, ${SEED_EMAIL}, '{"provider":"google"}'::jsonb)`,
    );
    await db.insert(profiles).values({
      userId: SEED_USER_ID,
      email: SEED_EMAIL,
      fullName: 'Test User',
      crpNumber: `${10000 + Math.floor(Math.random() * 89999)}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
      // Simulate a locked-out user who needs password reset
      failedLoginCount: 5,
      consecutiveLockouts: 3,
      lockoutUntil: new Date(Date.now() + 30 * 60_000),
      requiresPasswordReset: true,
    });
  });
}

describe('resetPassword (integration)', () => {
  it('updates password, revokes sessions, resets lockout, sends email, and redirects', async () => {
    await seedUser();

    getUserMock.mockResolvedValue({
      data: { user: { id: SEED_USER_ID, email: SEED_EMAIL } },
      error: null,
    });
    updateUserMock.mockResolvedValue({ data: { user: {} }, error: null });
    adminSignOutMock.mockResolvedValue({ data: {}, error: null });
    sendPasswordChangedEmailMock.mockResolvedValue({ ok: true });

    const { resetPassword } = await import('@/app/(auth)/reset-password/actions');

    const formData = buildFormData({
      password: STRONG_PASSWORD,
      passwordConfirm: STRONG_PASSWORD,
    });

    // The action calls redirect() which throws NEXT_REDIRECT
    await expect(resetPassword(formData)).rejects.toThrow('NEXT_REDIRECT');

    // Verify password update was called
    expect(updateUserMock).toHaveBeenCalledOnce();
    expect(updateUserMock).toHaveBeenCalledWith({ password: STRONG_PASSWORD });

    // Verify global session revocation
    expect(adminSignOutMock).toHaveBeenCalledOnce();
    expect(adminSignOutMock).toHaveBeenCalledWith(SEED_USER_ID, 'global');

    // Verify lockout state was reset in DB
    const updatedProfile = await runAsService(async (db) => {
      const rows = await db
        .select({
          failedLoginCount: profiles.failedLoginCount,
          consecutiveLockouts: profiles.consecutiveLockouts,
          lockoutUntil: profiles.lockoutUntil,
          requiresPasswordReset: profiles.requiresPasswordReset,
        })
        .from(profiles)
        .where(eq(profiles.userId, SEED_USER_ID))
        .limit(1);
      return rows[0];
    });

    expect(updatedProfile).toBeDefined();
    expect(updatedProfile!.failedLoginCount).toBe(0);
    expect(updatedProfile!.consecutiveLockouts).toBe(0);
    expect(updatedProfile!.lockoutUntil).toBeNull();
    expect(updatedProfile!.requiresPasswordReset).toBe(false);

    // Verify email notification was sent
    expect(sendPasswordChangedEmailMock).toHaveBeenCalledWith(SEED_EMAIL);

    // Verify redirect to login with banner
    expect(redirectMock).toHaveBeenCalledWith('/login?banner=password_changed');
  });

  it('rejects weak password with invalid_input', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: SEED_USER_ID, email: SEED_EMAIL } },
      error: null,
    });

    const { resetPassword } = await import('@/app/(auth)/reset-password/actions');

    const result = await resetPassword(
      buildFormData({
        password: 'weak',
        passwordConfirm: 'weak',
      }),
    );

    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('rejects mismatching passwords with invalid_input', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: SEED_USER_ID, email: SEED_EMAIL } },
      error: null,
    });

    const { resetPassword } = await import('@/app/(auth)/reset-password/actions');

    const result = await resetPassword(
      buildFormData({
        password: STRONG_PASSWORD,
        passwordConfirm: 'DifferentStr0ng!Pass99',
      }),
    );

    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns invalid_session when no recovery session exists', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthError', message: 'No user' },
    });

    const { resetPassword } = await import('@/app/(auth)/reset-password/actions');

    const result = await resetPassword(
      buildFormData({
        password: STRONG_PASSWORD,
        passwordConfirm: STRONG_PASSWORD,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'invalid_session' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
