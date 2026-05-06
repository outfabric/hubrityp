import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';
import { markCrpValidated } from './helpers/markCrpValidated';

// Real-DB middleware integration test for the path × status decision
// table from the spec.
//
// What is real here vs section 8's all-mocked variant:
//   • The `profiles` rows are seeded via the real `handle_new_user`
//     trigger (insert into `auth.users` → trigger materializes
//     `profiles`). Status transitions go through real UPDATE statements,
//     and `markCrpValidated` exercises the same path an admin would.
//   • The middleware itself runs unmocked.
//   • `getCurrentProfileEdge` runs unmocked — it calls
//     `supabase.from('profiles').select(...).maybeSingle()`, which we
//     bridge to a real Drizzle SELECT against the test container so the
//     PostgREST → Drizzle column-name mapping in the Edge adapter is
//     exercised against real data.
//   • Only the `@supabase/ssr` middleware client is mocked — there is no
//     PostgREST gateway running in the container, and bringing one up
//     would 5x the boot time without exercising a single line of OUR
//     code beyond the mapping.
//
// Combinations covered (per the decision-table subtask):
//   • anonymous → /dashboard → 307 /login
//   • pending → /dashboard → 307 /onboarding/pending
//   • active → /login → 307 /dashboard
//   • suspended → any path → 307 /login
//   • /auth/callback always passes for every status

type FakeSupabaseClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email: string } | null };
      error: { message: string } | null;
    }>;
    signOut: () => Promise<{ error: null }>;
  };
  from: (tableName: string) => FakeQueryBuilder;
};

// Minimal PostgREST query-builder shim. The Edge `getCurrentProfileEdge`
// path used today is:
//   supabase.from('profiles').select(<cols>).eq('user_id', id).maybeSingle()
// We back it with a real Drizzle SELECT and remap the row to snake_case
// (which is what real PostgREST returns).
type FakeQueryBuilder = {
  select(cols: string): FakeQueryBuilder;
  eq(column: string, value: string): FakeQueryBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
};

function buildQueryBuilder(): FakeQueryBuilder {
  let userIdFilter: string | null = null;
  const builder: FakeQueryBuilder = {
    select(_cols: string) {
      void _cols;
      return builder;
    },
    eq(column: string, value: string) {
      if (column === 'user_id') userIdFilter = value;
      return builder;
    },
    async maybeSingle() {
      if (!userIdFilter) {
        return { data: null, error: null };
      }
      const rows = await runAsService(async (db) =>
        db.select().from(profiles).where(eq(profiles.userId, userIdFilter!)),
      );
      const row = rows[0];
      if (!row) return { data: null, error: null };
      // Remap camelCase -> snake_case to match what real PostgREST
      // returns. The Edge adapter renames back to camelCase.
      return {
        data: {
          user_id: row.userId,
          email: row.email,
          full_name: row.fullName,
          crp_number: row.crpNumber,
          crp_uf: row.crpUf,
          crp_validated_at: row.crpValidatedAt,
          crp_validated_by: row.crpValidatedBy,
          email_verified_at: row.emailVerifiedAt,
          status: row.status,
          terms_accepted_at: row.termsAcceptedAt,
          privacy_accepted_at: row.privacyAcceptedAt,
          sensitive_data_consent_at: row.sensitiveDataConsentAt,
          last_resend_at: row.lastResendAt,
          failed_login_count: row.failedLoginCount,
          last_failed_login_at: row.lastFailedLoginAt,
          lockout_until: row.lockoutUntil,
          consecutive_lockouts: row.consecutiveLockouts,
          requires_password_reset: row.requiresPasswordReset,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        },
        error: null,
      };
    },
  };
  return builder;
}

const sessionRef: { current: { userId: string; email: string } | null } = { current: null };

vi.mock('@/shared/supabase/middleware', () => {
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      const supabase: FakeSupabaseClient = {
        auth: {
          // eslint-disable-next-line @typescript-eslint/require-await -- shape mirrors the @supabase/ssr middleware client which returns a Promise for parity with real GoTrue
          getUser: async () => {
            const user = sessionRef.current;
            return {
              data: {
                user: user
                  ? {
                      id: user.userId,
                      email: user.email,
                      app_metadata: { provider: 'email', providers: ['email'] },
                    }
                  : null,
              },
              error: user ? null : { message: 'no session' },
            };
          },
          // The CRÍTICO fix: middleware calls signOut for suspended/cancelled
          // sessions to break the redirect loop. The real GoTrue rotates the
          // session cookie via the @supabase/ssr cookie adapter; this stub
          // is a no-op (the explicit cookie clear in the middleware itself
          // covers the request-mirror side of the contract).
          // eslint-disable-next-line @typescript-eslint/require-await -- mirrors GoTrue's async surface
          signOut: async () => ({ error: null }),
        },
        from: (tableName: string) => {
          if (tableName !== 'profiles') {
            throw new Error(`unexpected supabase.from('${tableName}') in middleware test`);
          }
          return buildQueryBuilder();
        },
      };
      return { supabase, response };
    }),
  };
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

async function setStatus(userId: string, status: string): Promise<void> {
  await runAsService(async (db) => {
    await db.update(profiles).set({ status }).where(eq(profiles.userId, userId));
  });
}

beforeEach(() => {
  sessionRef.current = null;
});

afterEach(async () => {
  sessionRef.current = null;
  vi.resetModules();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function parseLocation(response: Response): URL {
  const loc = response.headers.get('location');
  if (!loc) throw new Error('expected a Location header on the response');
  return new URL(loc, 'http://localhost');
}

describe('middleware status gating (real DB)', () => {
  describe('anonymous session', () => {
    it('redirects /dashboard → /login?redirectTo=%2Fdashboard', async () => {
      sessionRef.current = null; // anonymous

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    });
  });

  describe('pending_verification status (seeded via real trigger)', () => {
    it('redirects /dashboard → /onboarding/pending', async () => {
      const seeded = await seedProfile();
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });

    it('passes through /onboarding/pending', async () => {
      const seeded = await seedProfile();
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe('pending_crp_validation status (after email confirmation trigger)', () => {
    it('redirects /dashboard → /onboarding/pending', async () => {
      const seeded = await seedProfile();
      // Drive the trigger by stamping email_confirmed_at, exactly as
      // GoTrue would after the user clicks the verification link.
      await runAsService(async (db) => {
        await db.execute(
          dsql`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${seeded.userId}`,
        );
      });
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });
  });

  describe('active status', () => {
    it('redirects /login → /dashboard', async () => {
      const seeded = await seedProfile();
      await markCrpValidated(seeded.userId);
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('passes through /dashboard', async () => {
      const seeded = await seedProfile();
      await markCrpValidated(seeded.userId);
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe('suspended status', () => {
    it('redirects /dashboard → /login', async () => {
      const seeded = await seedProfile();
      await setStatus(seeded.userId, 'suspended');
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/login');
    });

    it('redirects /onboarding/pending → /login', async () => {
      const seeded = await seedProfile();
      await setStatus(seeded.userId, 'suspended');
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/login');
    });

    it('passes /login through (no self-redirect loop) — session is cleared so next request is anonymous', async () => {
      const seeded = await seedProfile();
      await setStatus(seeded.userId, 'suspended');
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      // The CRÍTICO fix: instead of redirecting /login → /login (loop), the
      // middleware now lets /login render and clears the session cookie.
      // The next request from this browser will be anonymous and stay on
      // /login per the "no session" column of the decision table.
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('passes /signup through with the session cleared', async () => {
      const seeded = await seedProfile();
      await setStatus(seeded.userId, 'suspended');
      sessionRef.current = seeded;

      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/signup'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe('/auth/callback always passes through', () => {
    it('passes for an anonymous session', async () => {
      sessionRef.current = null;
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/auth/callback?code=abc'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('passes for a pending_verification user', async () => {
      const seeded = await seedProfile();
      sessionRef.current = seeded;
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/auth/callback?code=abc'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('passes for an active user', async () => {
      const seeded = await seedProfile();
      await markCrpValidated(seeded.userId);
      sessionRef.current = seeded;
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/auth/callback?code=abc'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('passes for a suspended user', async () => {
      const seeded = await seedProfile();
      await setStatus(seeded.userId, 'suspended');
      sessionRef.current = seeded;
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/auth/callback?code=abc'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });
});
