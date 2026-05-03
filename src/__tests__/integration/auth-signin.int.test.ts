import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// `signIn` is exercised against a mocked `@supabase/ssr` boundary so every
// scenario (success, invalid credentials, malformed input, status-aware
// redirect, terminal-status sign-out, etc.) can be staged without a real
// GoTrue. The action itself runs unmocked against the real Postgres test
// container — the DB-driven status branch needs a real `psychologist_profiles`
// row for `getAccountStatus` to read.
//
// Successful sign-in calls `redirect()`, which throws a special
// `NEXT_REDIRECT` marker carrying the target on `error.digest`. Tests assert
// that target is parsed from the digest. Failures (typed `SignInResult`)
// resolve normally and the page renders an inline error.

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
    },
  }),
}));

const warnSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  redactPaths: [],
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
  warnSpy.mockReset();
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
  const target = parts[2];
  if (!target) throw new Error(`could not parse target from digest: ${digest}`);
  return target;
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function seedAuthUser(userId: string, email: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedProfile(userId: string, status: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(psychologistProfiles).values({
      userId,
      fullName: 'Test User',
      crpNumber: `06/${String(Math.floor(100000 + Math.random() * 900000))}`,
      crpUf: 'SP',
      status,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
      termsVersion: '2026-05',
      privacyVersion: '2026-05',
      sensitiveDataConsentVersion: '2026-05',
    });
  });
}

// Helper: stage a successful Supabase signin returning the given user id.
function mockSignInOk(userId: string): void {
  signInWithPasswordMock.mockResolvedValue({
    data: { user: { id: userId, email: 'doctor@example.com' } },
    error: null,
  });
}

describe('signIn Server Action (integration)', () => {
  describe('success path — status-aware redirect', () => {
    it('redirects active user to /dashboard by default', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'active');
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: 'doctor@example.com',
        password: 'correct-horse',
      });
      expect(extractRedirectTarget(caught)).toBe('/dashboard');
      // Active user MUST NOT be signed out.
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('honours a same-origin redirectTo of "/patients" for active users', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'active');
      mockSignInOk(userId);

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

    it('honours a deeper same-origin redirectTo like "/dashboard/settings" for active users', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'active');
      mockSignInOk(userId);

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

    it('redirects pending_verification user to /auth/verify-email even when redirectTo is set', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'pending_verification');
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(
          buildFormData({
            email: 'doctor@example.com',
            password: 'correct-horse',
            redirectTo: '/dashboard',
          }),
        );
      } catch (err) {
        caught = err;
      }

      // Bloqueante page wins over the requested redirect.
      expect(extractRedirectTarget(caught)).toBe('/auth/verify-email');
      // Pending users keep their session — only suspended/cancelled get
      // signed out at login.
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('redirects pending_crp_validation user to /auth/crp-review even when redirectTo is set', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'pending_crp_validation');
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(
          buildFormData({
            email: 'doctor@example.com',
            password: 'correct-horse',
            redirectTo: '/dashboard',
          }),
        );
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/auth/crp-review');
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('signs out suspended user and redirects to /login?reason=suspended', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'suspended');
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/login?reason=suspended');
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });

    it('signs out cancelled user and redirects to /login?reason=cancelled', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'doctor@example.com');
      await seedProfile(userId, 'cancelled');
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      let caught: unknown = null;
      try {
        await signIn(buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }));
      } catch (err) {
        caught = err;
      }

      expect(extractRedirectTarget(caught)).toBe('/login?reason=cancelled');
      expect(signOutMock).toHaveBeenCalledTimes(1);
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
      'falls back to /dashboard when redirectTo is $label (active user)',
      async ({ value }) => {
        const userId = randomUUID();
        await seedAuthUser(userId, 'doctor@example.com');
        await seedProfile(userId, 'active');
        mockSignInOk(userId);

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
    });

    it('does not redirect when an unexpected error occurs', async () => {
      signInWithPasswordMock.mockRejectedValue(new Error('boom'));

      const { signIn } = await import('@/app/(auth)/login/actions');

      // No try/catch: if `redirect()` were called inside the unknown branch
      // it would throw NEXT_REDIRECT and this `await` would itself throw.
      const result = await signIn(
        buildFormData({
          email: 'doctor@example.com',
          password: 'correct-horse',
          redirectTo: '/dashboard',
        }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
    });

    it('returns unknown when Supabase returns success but no user id', async () => {
      // Edge case: Supabase reports `error: null` but no `user` object. We
      // cannot determine status without the id, so the action MUST return
      // `unknown` and NOT redirect.
      signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: null });

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'doctor@example.com', password: 'correct-horse' }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
    });

    it('returns unknown and signs the user out when there is no profile row', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'orphan@example.com');
      // NO profile row for this user — simulates a stuck mid-signup or
      // post-LGPD-deletion state.
      mockSignInOk(userId);

      const { signIn } = await import('@/app/(auth)/login/actions');

      const result = await signIn(
        buildFormData({ email: 'orphan@example.com', password: 'correct-horse' }),
      );

      expect(result).toEqual({ ok: false, error: 'unknown' });
      // Orphan session signed out so the user does not loop on a
      // dashboard the middleware will reject anyway.
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });
  });
});
