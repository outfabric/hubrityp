import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RegistrationModule from '@/modules/registration';

// `signIn` is exercised against a mocked `@supabase/ssr` boundary so every
// scenario (success, invalid credentials, malformed input, unknown failure,
// open-redirect attempts, status-aware branches) can be staged without a
// real GoTrue. The action itself runs unmocked — the assertions cover its
// behaviour, not Supabase's.
//
// Status-aware sign-in (section 7 of the change) layers `getCurrentProfile`
// on top of `signInWithPassword`. We mock that function from
// `@/modules/registration` so each test can stage `active`,
// `pending_verification`, `pending_crp_validation`, `suspended`,
// `cancelled`, or a missing-profile race without standing up Postgres.
// `importOriginal` preserves the rest of the barrel (notably
// `ProfileStatus`, which the impl imports as a value).
//
// Successful sign-in calls `redirect()`, which throws a special
// `NEXT_REDIRECT` marker carrying the target on `error.digest`. Tests assert
// that target is parsed from the digest. Failures must NOT throw — they
// resolve to a typed `SignInResult` so the page can render an inline error.

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();
const getCurrentProfileMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock('@/modules/registration', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistrationModule>();
  return {
    ...actual,
    getCurrentProfile: getCurrentProfileMock,
  };
});

// Mock dependencies introduced by the login hardening rewrite. These are
// needed because `signInImpl` now imports `db` for profile lookup, cookies
// for keepLoggedIn, logAuthEvent for audit logging, and sendAccountLockedEmail.
vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
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
  getCurrentProfileMock.mockReset();

  // Default for tests that don't care about the profile branch — most
  // success-path assertions assume an `active` user with onboarding already
  // finished, so the redirect resolves to /dashboard (or `redirectTo`) rather
  // than the first-run wizard. Onboarding-incomplete coverage lives in
  // `registration/sign-in-status-aware.int.test.ts`.
  getCurrentProfileMock.mockResolvedValue({
    userId: '00000000-0000-0000-0000-000000000000',
    status: 'active',
    onboardingStep: 'done',
    onboardingCompletedAt: null,
  });
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetModules();
});

// `redirect()` from `next/navigation` throws an Error whose `digest` starts
// with `NEXT_REDIRECT;<replace|push>;<target>;<status>;...`. The exact
// separator/format is an internal contract; we extract the second segment
// (the target path) by splitting on `;` and indexing 2.
function extractRedirectTarget(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new Error(`expected Error with NEXT_REDIRECT digest, got ${typeof error}`);
  }
  const digest = (error as Error & { digest?: string }).digest;
  if (!digest || !digest.startsWith('NEXT_REDIRECT')) {
    throw new Error(`expected NEXT_REDIRECT digest, got: ${String(digest)}`);
  }
  const parts = digest.split(';');
  // Layout: ['NEXT_REDIRECT', <kind>, <target>, ...]
  const target = parts[2];
  if (!target) throw new Error(`could not parse target from digest: ${digest}`);
  return target;
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('signIn Server Action (integration)', () => {
  describe('success path (active profile)', () => {
    it('writes session via @supabase/ssr and redirects to /dashboard by default', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      // `signInWithPassword` was the only call into Supabase Auth, with the
      // exact validated payload (no extra fields, no formData artifacts).
      expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: 'doctor@example.com',
        password: 'correct-horse',
      });
      // `getCurrentProfile` ran exactly once after a successful auth — the
      // status-aware branch needs the profile row to decide redirect target.
      expect(getCurrentProfileMock).toHaveBeenCalledTimes(1);
      // `signOut` was NOT called — active accounts keep their session.
      expect(signOutMock).not.toHaveBeenCalled();

      // The action threw a NEXT_REDIRECT for /dashboard.
      expect(extractRedirectTarget(caught)).toBe('/dashboard');
    });

    it('honours a same-origin redirectTo of "/patients"', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(
          buildFormData({
            email: 'doctor@example.com',
            password: 'correct-horse',
            redirectTo: '/patients',
          }),
        );
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/patients');
    });

    it('honours a deeper same-origin redirectTo like "/dashboard/settings"', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(
          buildFormData({
            email: 'doctor@example.com',
            password: 'correct-horse',
            redirectTo: '/dashboard/settings',
          }),
        );
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/dashboard/settings');
    });
  });

  describe('redirectTo validation (open-redirect defense)', () => {
    const hostileTargets: { label: string; value: string }[] = [
      { label: 'absolute https URL', value: 'https://evil.example.com' },
      { label: 'protocol-relative URL', value: '//evil.example.com' },
      { label: 'javascript scheme', value: 'javascript:alert(1)' },
      { label: 'mailto scheme', value: 'mailto:foo@bar.com' },
      { label: 'path with embedded colon before first slash', value: '/foo:bar/baz' },
      { label: 'empty string', value: '' },
    ];

    it.each(hostileTargets)(
      'falls back to /dashboard when redirectTo is $label',
      async ({ value }) => {
        signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });

        const { signIn } = await import('@/app/(auth)/login/actions');

        let caught: unknown = null;
        try {
          await signIn(
            buildFormData({
              email: 'doctor@example.com',
              password: 'correct-horse',
              redirectTo: value,
            }),
          );
        } catch (err) {
          caught = err;
        }

        expect(extractRedirectTarget(caught)).toBe('/dashboard');
      },
    );
  });

  describe('pending profile statuses', () => {
    // `pending_crp_validation` is the only pending status that can reach the
    // success-path switch. With Supabase email confirmation enabled a
    // `pending_verification` user can never hold a session — GoTrue returns
    // `email_not_confirmed` before a session exists — so that arm was removed.
    // A confirmed-but-CRP-pending user MUST route to `/onboarding/pending`
    // regardless of any `redirectTo`; letting `redirectTo` win would bypass
    // the onboarding gate and surface a half-functional shell deeper in the app.
    it('redirects to /onboarding/pending when profile.status is pending_crp_validation', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
      getCurrentProfileMock.mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        status: 'pending_crp_validation',
      });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/onboarding/pending');
      // Pending users keep their session — no signOut.
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('ignores a same-origin redirectTo for pending_crp_validation', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
      getCurrentProfileMock.mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        status: 'pending_crp_validation',
      });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(
          buildFormData({
            email: 'doctor@example.com',
            password: 'correct-horse',
            redirectTo: '/dashboard/settings',
          }),
        );
      } catch (err) {
        caught = err;
      }

      // `redirectTo` MUST be ignored — the onboarding hold page wins.
      expect(extractRedirectTarget(caught)).toBe('/onboarding/pending');
    });
  });

  describe('account_unavailable (suspended / cancelled)', () => {
    const blockedStatuses = [
      { label: 'suspended', value: 'suspended' as const },
      { label: 'cancelled', value: 'cancelled' as const },
    ];

    it.each(blockedStatuses)(
      'signs the user back out and returns account_unavailable when status is $label',
      async ({ value }) => {
        signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
        getCurrentProfileMock.mockResolvedValue({
          userId: '00000000-0000-0000-0000-000000000002',
          status: value,
        });

        const { signIn } = await import('@/app/(auth)/login/actions');

        const result = await signIn(
          buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }),
        );

        expect(result).toEqual({ ok: false, error: 'account_unavailable' });
        // The session cookie that `signInWithPassword` just wrote MUST be
        // cleared — leaving it in place would let the user navigate into the
        // app shell despite the typed error.
        expect(signOutMock).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('missing profile (defensive)', () => {
    it('returns unknown and signs out when getCurrentProfile resolves to null', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
      getCurrentProfileMock.mockResolvedValue(null);

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }),
      );

      // The trigger that materializes `profiles` rows runs synchronously on
      // `auth.users` insert, so a null here in production implies a session
      // that no longer maps to a profile. The safe path is signOut + unknown.
      expect(result).toEqual({ ok: false, error: 'unknown' });
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalid credentials', () => {
    it('returns { ok: false, error: "invalid_credentials" } when Supabase rejects', async () => {
      signInWithPasswordMock.mockResolvedValue({
        data: { user: null, session: null },
        error: { name: 'AuthApiError', message: 'Invalid login credentials' },
      });

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'wrong-password' }),
      );

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
      // Crucially: no redirect happened. If `redirect()` had been called the
      // line above would have thrown NEXT_REDIRECT and we would never reach
      // this assertion.
      expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      // `getCurrentProfile` must NOT have been called when auth itself
      // failed — the status-aware branch only runs on auth success.
      expect(getCurrentProfileMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed input', () => {
    it('returns invalid_credentials for a bad email and never calls Supabase', async () => {
      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'not-an-email', password: 'long-enough-password' }),
      );

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
      expect(getCurrentProfileMock).not.toHaveBeenCalled();
    });

    it('returns invalid_credentials for a password shorter than 8 chars', async () => {
      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'short' }),
      );

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
    });

    it('returns invalid_credentials when fields are missing entirely', async () => {
      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(new FormData());

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
    });
  });

  describe('unexpected errors', () => {
    it('returns { ok: false, error: "unknown" } when the Supabase call throws', async () => {
      signInWithPasswordMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'));

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
      // The exception was swallowed (logged) — it MUST NOT propagate to the
      // form, which would surface a generic Next.js error overlay instead of
      // an inline message.
    });

    it('returns unknown when getCurrentProfile throws after a successful auth', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
      getCurrentProfileMock.mockRejectedValue(new Error('db connection refused'));

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
    });

    it('does not redirect when an unexpected error occurs', async () => {
      signInWithPasswordMock.mockRejectedValue(new Error('boom'));

      const { signIn } = await import('@/app/(auth)/login/actions');

      // No try/catch: if `redirect()` were called inside the unknown branch
      // it would throw NEXT_REDIRECT and this `await` would itself throw.
      // Reaching the next line proves no redirect happened.
      const result = await signIn(
        buildFormData({
          email: 'doctor@example.com',
          password: 'correct-horse',
          redirectTo: '/dashboard',
        }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
    });
  });
});
