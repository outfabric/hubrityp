import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `signIn` is exercised against a mocked `@supabase/ssr` boundary so every
// scenario (success, invalid credentials, malformed input, unknown failure,
// open-redirect attempts) can be staged without a real GoTrue. The action
// itself runs unmocked — the assertions cover its behaviour, not Supabase's.
//
// Successful sign-in calls `redirect()`, which throws a special
// `NEXT_REDIRECT` marker carrying the target on `error.digest`. Tests assert
// that target is parsed from the digest. Failures must NOT throw — they
// resolve to a typed `SignInResult` so the page can render an inline error.

const signInWithPasswordMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
    },
  }),
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
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
  describe('success path', () => {
    it('writes session via @supabase/ssr and redirects to /dashboard by default', async () => {
      signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      // `signInWithPassword` was the only call into Supabase, with the
      // exact validated payload (no extra fields, no formData artifacts).
      expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: 'doctor@example.com',
        password: 'correct-horse',
      });

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
