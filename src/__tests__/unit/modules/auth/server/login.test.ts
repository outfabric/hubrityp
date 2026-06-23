import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PENDING_EMAIL_COOKIE_NAME } from '@/shared/lib/cookies/pending-email';

// ---------------------------------------------------------------------------
// 4.3 — `email_not_confirmed` is NOT a failed-credentials event
//
// GoTrue returns `email_not_confirmed` (HTTP 422) only AFTER the password has
// been validated, so the attempt is a legitimate (correct-password) login that
// is merely blocked on confirmation. `signInImpl` MUST:
//   - NOT call `applyFailedLoginAttempt` (no lockout-counter mutation),
//   - set the signed `pending-email` cookie,
//   - return `{ ok: false, error: 'email_not_confirmed' }`.
//
// Every external boundary is mocked so the action runs unmocked against staged
// inputs: Supabase auth (returns the 422 error), the Drizzle client (resolves
// an existing profile so we exercise the `existingProfile` path), the lockout
// helpers (spied to PROVE they are never invoked), cookies, and audit logging.
// ---------------------------------------------------------------------------

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();
const cookieSetMock = vi.fn();

const applyFailedLoginAttemptMock = vi.fn();
const resetLoginCountersMock = vi.fn();
const isCurrentlyLockedOutMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
    },
  }),
}));

// Resolve an existing profile so the action reaches the post-auth-failure
// branch with `existingProfile` set — this is the path where the lockout
// counter WOULD be touched for a real failed-credentials event.
const existingProfileRow = {
  userId: '00000000-0000-0000-0000-000000000009',
  lockoutUntil: null,
  requiresPasswordReset: false,
};

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingProfileRow]),
        }),
      }),
    }),
  },
}));

vi.mock('@/modules/auth/server/lockout', () => ({
  applyFailedLoginAttempt: applyFailedLoginAttemptMock,
  resetLoginCounters: resetLoginCountersMock,
  // Default to "not locked out" so the lockout pre-check lets the action
  // proceed all the way to the Supabase call.
  isCurrentlyLockedOut: isCurrentlyLockedOutMock,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: cookieSetMock,
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/modules/registration/server/log-auth-event', () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/lib/mail/send-account-locked', () => ({
  sendAccountLockedEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signOutMock.mockReset();
  cookieSetMock.mockReset();
  applyFailedLoginAttemptMock.mockReset();
  resetLoginCountersMock.mockReset();
  isCurrentlyLockedOutMock.mockReset();

  signOutMock.mockResolvedValue({ error: null });
  isCurrentlyLockedOutMock.mockReturnValue({ lockedOut: false });
});

afterEach(() => {
  vi.resetModules();
});

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('signInImpl — email_not_confirmed (no lockout)', () => {
  it('returns email_not_confirmed and never touches lockout counters (code branch)', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthApiError', message: 'Email not confirmed', code: 'email_not_confirmed' },
    });

    const { signInImpl } = await import('@/modules/auth/server/login');

    const result = await signInImpl(
      buildFormData({ email: 'unconfirmed@example.com', password: 'correct-horse' }),
    );

    expect(result).toEqual({ ok: false, error: 'email_not_confirmed' });

    // The lockout counter MUST NOT be mutated — this is the regression the
    // section fixes: an unconfirmed account must not be able to lock itself out.
    expect(applyFailedLoginAttemptMock).not.toHaveBeenCalled();
    expect(resetLoginCountersMock).not.toHaveBeenCalled();

    // The signed pending-email cookie was written so the public verify page
    // can resend the confirmation link.
    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    expect(cookieSetMock).toHaveBeenCalledWith(
      PENDING_EMAIL_COOKIE_NAME,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('treats HTTP 422 as email_not_confirmed even without the code field (status branch)', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthApiError', message: 'Email not confirmed', status: 422 },
    });

    const { signInImpl } = await import('@/modules/auth/server/login');

    const result = await signInImpl(
      buildFormData({ email: 'unconfirmed@example.com', password: 'correct-horse' }),
    );

    expect(result).toEqual({ ok: false, error: 'email_not_confirmed' });
    expect(applyFailedLoginAttemptMock).not.toHaveBeenCalled();
    expect(cookieSetMock).toHaveBeenCalledWith(
      PENDING_EMAIL_COOKIE_NAME,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('a wrong password (invalid_credentials) still goes through the lockout path', async () => {
    // Sanity guard: the new branch must NOT swallow genuine failed credentials.
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid login credentials',
        code: 'invalid_credentials',
      },
    });
    applyFailedLoginAttemptMock.mockResolvedValue({
      lockoutJustStarted: false,
      requiresPasswordReset: false,
      lockoutUntil: null,
    });

    const { signInImpl } = await import('@/modules/auth/server/login');

    const result = await signInImpl(
      buildFormData({ email: 'unconfirmed@example.com', password: 'wrong-password' }),
    );

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    // The failed-credentials path DOES touch the lockout counter.
    expect(applyFailedLoginAttemptMock).toHaveBeenCalledTimes(1);
    // No pending-email cookie on a genuine credential failure.
    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});
