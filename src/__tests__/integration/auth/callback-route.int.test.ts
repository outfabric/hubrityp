import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Integration test for the `/auth/callback` Route Handler. Three scenarios
// from `account-lifecycle/spec.md`:
//
//   1. Valid code for a `pending_verification` user → status becomes
//      `pending_crp_validation` (DB-asserted) and the response is 307 to
//      `/dashboard`.
//   2. Valid code for an already-verified user (status
//      `pending_crp_validation`) → response is 307 to `/dashboard`, status
//      unchanged (idempotent — `applyTransition` returns
//      `invalid_transition`, which the handler treats as success).
//   3. Invalid/missing code → response is 307 to
//      `/login?reason=verification_failed`.
//
// Supabase is mocked at the `exchangeCodeForSession` boundary so each test
// can stage exact responses (success → user id, error → typed AuthError).
// The DB transition itself runs unmocked against the real test container.

const exchangeCodeForSessionMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
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
  exchangeCodeForSessionMock.mockReset();
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

async function readStatus(userId: string): Promise<string | null> {
  const rows = await runAsService(async (db) =>
    db
      .select({ status: psychologistProfiles.status })
      .from(psychologistProfiles)
      .where(eq(psychologistProfiles.userId, userId))
      .limit(1),
  );
  return rows[0]?.status ?? null;
}

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/auth/callback${query}`);
}

function parseLocation(response: Response): URL {
  const loc = response.headers.get('location');
  if (!loc) throw new Error('expected a Location header on the response');
  return new URL(loc, 'http://localhost');
}

describe('GET /auth/callback (integration)', () => {
  describe('module surface', () => {
    it('exports a `GET` async function', async () => {
      const route = await import('@/app/auth/callback/route');
      expect(typeof route.GET).toBe('function');
    });
  });

  describe('happy path — pending_verification advances to pending_crp_validation', () => {
    it('advances status and redirects 307 to /dashboard', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'verify@example.com');
      await seedProfile(userId, 'pending_verification');

      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: { id: userId, email: 'verify@example.com' } },
        error: null,
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=valid-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');

      // DB assertion: status advanced.
      expect(await readStatus(userId)).toBe('pending_crp_validation');

      // Supabase exchange was called with the right code.
      expect(exchangeCodeForSessionMock).toHaveBeenCalledTimes(1);
      expect(exchangeCodeForSessionMock).toHaveBeenCalledWith('valid-code');
    });
  });

  describe('idempotency — already-verified user clicks the link again', () => {
    it('redirects 307 to /dashboard and leaves status unchanged', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'verify@example.com');
      // Already past verification.
      await seedProfile(userId, 'pending_crp_validation');

      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: { id: userId, email: 'verify@example.com' } },
        error: null,
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=valid-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');

      // DB assertion: status did NOT regress (still pending_crp_validation).
      expect(await readStatus(userId)).toBe('pending_crp_validation');
    });

    it('redirects 307 to /dashboard for an active user (also idempotent)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId, 'verify@example.com');
      await seedProfile(userId, 'active');

      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: { id: userId, email: 'verify@example.com' } },
        error: null,
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=valid-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
      expect(await readStatus(userId)).toBe('active');
    });
  });

  describe('failure paths', () => {
    it('redirects 307 to /login?reason=verification_failed when the code is missing', async () => {
      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest(''));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('verification_failed');

      // No Supabase call when the code is missing.
      expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    });

    it('redirects 307 to /login?reason=verification_failed when Supabase returns an error', async () => {
      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: null },
        error: { name: 'AuthApiError', message: 'invalid code' },
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=invalid-code'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('verification_failed');
    });

    it('redirects 307 to /login?reason=verification_failed when Supabase returns no user', async () => {
      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=any-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('verification_failed');
    });

    it('redirects 307 to /login?reason=verification_failed when the Supabase call throws', async () => {
      exchangeCodeForSessionMock.mockRejectedValue(new Error('network'));

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=any-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('verification_failed');
    });
  });

  describe('post-exchange anomalies — session is real, fall through to /dashboard', () => {
    it('still redirects to /dashboard when the user has no profile row', async () => {
      // Edge case: signup partially rolled back, or the user was hard-
      // deleted. The session is real (the exchange succeeded), so we let
      // the user through to /dashboard and let the middleware route them
      // by their (non-existent) status.
      const userId = randomUUID();
      await seedAuthUser(userId, 'orphan@example.com');
      // No profile row.

      exchangeCodeForSessionMock.mockResolvedValue({
        data: { user: { id: userId, email: 'orphan@example.com' } },
        error: null,
      });

      const { GET } = await import('@/app/auth/callback/route');
      const response = await GET(makeRequest('?code=valid-code'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });
  });
});
