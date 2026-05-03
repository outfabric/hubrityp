import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Integration tests for the `/auth/verify-email` route shell.
//
// We pin the four observable shell contracts:
//
//   • anonymous → redirect('/login?redirectTo=/auth/verify-email')
//   • authenticated active                  → redirect('/dashboard')
//   • authenticated pending_verification    → renders the page (returns JSX)
//   • authenticated pending_crp_validation  → redirect('/auth/crp-review')
//
// `redirect()` from `next/navigation` throws an Error whose `digest` starts
// with `NEXT_REDIRECT;<replace|push>;<target>;<status>;...`. We mirror the
// extraction helper used by `auth-signin.int.test.ts` and parse the target
// from the digest.
//
// Supabase is mocked at the `createServerClient` boundary so each test can
// stage either an authenticated session (returns a user id) or an anonymous
// session (returns null). The route shell itself runs unmocked against the
// real Postgres test container — the DB-driven status branch needs a real
// `psychologist_profiles` row for `getAccountStatus` to read.

const getUserMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

const warnSpy = vi.fn();
const infoSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: vi.fn(),
    info: (...args: unknown[]): void => {
      infoSpy(...args);
    },
    debug: vi.fn(),
  },
  redactPaths: [],
}));

beforeEach(() => {
  getUserMock.mockReset();
  warnSpy.mockReset();
  infoSpy.mockReset();
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

describe('verify-email route shell — module surface', () => {
  it('actions.ts exposes `resendVerificationEmail` and `signOut` as functions', async () => {
    const shell = await import('@/app/(auth)/auth/verify-email/actions');
    expect(typeof shell.resendVerificationEmail).toBe('function');
    expect(typeof shell.signOut).toBe('function');
  });

  it('page.tsx module loads without throwing at import time', async () => {
    const pageModule = await import('@/app/(auth)/auth/verify-email/page');
    expect(typeof pageModule.default).toBe('function');
  });
});

describe('verify-email route shell — page behaviour (integration)', () => {
  it('redirects anonymous users to /login?redirectTo=/auth/verify-email', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login?redirectTo=/auth/verify-email');
  });

  it('redirects active users to /dashboard', async () => {
    const userId = randomUUID();
    const email = 'active@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'active');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/dashboard');
  });

  it('redirects pending_crp_validation users to /auth/crp-review', async () => {
    const userId = randomUUID();
    const email = 'crp-pending@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_crp_validation');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/auth/crp-review');
  });

  it('redirects suspended users to /login?reason=suspended', async () => {
    const userId = randomUUID();
    const email = 'suspended@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'suspended');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login?reason=suspended');
  });

  it('redirects cancelled users to /login?reason=cancelled', async () => {
    const userId = randomUUID();
    const email = 'cancelled@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'cancelled');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login?reason=cancelled');
  });

  it('redirects orphan sessions (no profile row) to /login', async () => {
    const userId = randomUUID();
    const email = 'orphan@example.com';
    await seedAuthUser(userId, email);
    // No profile row.
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('renders the page (returns JSX) for pending_verification users', async () => {
    const userId = randomUUID();
    const email = 'psi@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/verify-email/page');

    // The happy path returns JSX synchronously without throwing. We assert
    // the call resolves and returns a React element (truthy object).
    const result = await pageModule.default();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });
});
