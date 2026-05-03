import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Integration tests for the `/auth/crp-review` route shell.
//
// Mirrors `verify-email-route-shell.int.test.ts` exactly — the contracts
// are symmetric: the only difference is which status leads to the rendered
// page versus a redirect.
//
//   • anonymous → redirect('/login?redirectTo=/auth/crp-review')
//   • authenticated active                   → redirect('/dashboard')
//   • authenticated pending_verification     → redirect('/auth/verify-email')
//   • authenticated pending_crp_validation   → renders the page
//   • authenticated suspended                → redirect('/login?reason=suspended')
//   • authenticated cancelled                → redirect('/login?reason=cancelled')
//   • authenticated, no profile (orphan)     → redirect('/login')

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

async function seedProfile(
  userId: string,
  status: string,
  overrides: { crpNumber?: string; crpUf?: string } = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(psychologistProfiles).values({
      userId,
      fullName: 'Test User',
      crpNumber: overrides.crpNumber ?? `06/${String(Math.floor(100000 + Math.random() * 900000))}`,
      crpUf: overrides.crpUf ?? 'SP',
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

describe('crp-review route shell — module surface', () => {
  it('actions.ts exposes `signOut` as a function', async () => {
    const shell = await import('@/app/(auth)/auth/crp-review/actions');
    expect(typeof shell.signOut).toBe('function');
  });

  it('page.tsx module loads without throwing at import time', async () => {
    const pageModule = await import('@/app/(auth)/auth/crp-review/page');
    expect(typeof pageModule.default).toBe('function');
  });
});

describe('crp-review route shell — page behaviour (integration)', () => {
  it('redirects anonymous users to /login?redirectTo=/auth/crp-review', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login?redirectTo=/auth/crp-review');
  });

  it('redirects active users to /dashboard', async () => {
    const userId = randomUUID();
    const email = 'active@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'active');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/dashboard');
  });

  it('redirects pending_verification users to /auth/verify-email', async () => {
    const userId = randomUUID();
    const email = 'verify-pending@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/auth/verify-email');
  });

  it('redirects suspended users to /login?reason=suspended', async () => {
    const userId = randomUUID();
    const email = 'suspended@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'suspended');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

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

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

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

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

    let caught: unknown = null;
    try {
      await pageModule.default();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('renders the page (returns JSX) for pending_crp_validation users', async () => {
    const userId = randomUUID();
    const email = 'crp-pending@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_crp_validation', {
      crpNumber: '06/123456',
      crpUf: 'SP',
    });
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const pageModule = await import('@/app/(auth)/auth/crp-review/page');

    const result = await pageModule.default();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });
});
