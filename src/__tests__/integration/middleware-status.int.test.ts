import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AccountLifecycleModule from '@/modules/account-lifecycle';
import { type AccountStatus } from '@/modules/account-lifecycle';

// Status × path matrix for the root middleware (section 7 of
// `add-account-signup-and-lifecycle`). The contract sources are:
//   • `specs/authentication/spec.md` — Requirement "Middleware enforces auth
//     gating for `(app)` routes".
//   • `specs/account-lifecycle/spec.md` — Requirement "Status drives access
//     to authenticated areas".
//
// We mock the two boundaries the middleware crosses (Supabase + the account-
// lifecycle status read) so each test stages a clean (auth, status) pair
// without booting GoTrue or hitting Postgres. The middleware itself runs
// unmocked; this is what makes the file an integration test even though the
// graph is small — we exercise the real path classifier, the real cookie
// transplanter, and the real status-routing branches end-to-end.
//
// What the matrix covers (5 statuses × 5 paths = 25 cases) plus edge cases:
//   • `/dashboard`              — happy and bloqueante redirects.
//   • `/login`, `/signup`       — authenticated bounce.
//   • `/auth/verify-email`,
//     `/auth/crp-review`        — render correct gate, redirect away from
//                                 the wrong gate.
//   • Anonymous on each path.
//   • Always-passthrough surfaces (`/auth/callback`, `/api/*`, `/`).
//   • Suspended/cancelled cookie clear (asserted by Set-Cookie inspection).
//   • Orphan session (`status === null`) → cookie clear + reason=profile_missing.
//   • `getAccountStatus` throws → fail-closed-for-app, passthrough-for-public.

// `vi.mock` calls are hoisted to the top of the module BEFORE module-level
// `const` declarations execute. Variables referenced inside the factory must
// therefore live inside `vi.hoisted` so they are evaluated together with the
// hoist. Without this, a freshly evaluated factory races the const init and
// throws `Cannot access 'X' before initialization`. The sibling
// `middleware.int.test.ts` happens to dodge the race because Vitest's
// internal evaluation order differs by file size / mock count, but the
// pattern below is the documented-safe form.
const { getUserMock, getAccountStatusMock, errorLogMock } = vi.hoisted(() => {
  return {
    getUserMock: vi.fn(),
    getAccountStatusMock: vi.fn(),
    errorLogMock: vi.fn(),
  };
});

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  // The middleware imports both `createMiddlewareClient` and
  // `clearSupabaseAuthCookies`. We want the cookie-clear path to be
  // OBSERVABLE in tests, so we ship a real (small) implementation that the
  // middleware will call. Tests assert on `Set-Cookie` headers in the
  // response to prove deletes happened.
  const SUPABASE_AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/;
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: { auth: { getUser: getUserMock } },
        response,
      };
    }),
    clearSupabaseAuthCookies: (
      request: NextRequest,
      response: InstanceType<typeof NextResponse>,
    ) => {
      const names = request.cookies
        .getAll()
        .map((c) => c.name)
        .filter((n) => SUPABASE_AUTH_COOKIE.test(n));
      for (const name of names) {
        response.cookies.delete(name);
      }
    },
    findSupabaseAuthCookieNames: (request: NextRequest) =>
      request.cookies
        .getAll()
        .map((c) => c.name)
        .filter((n) => SUPABASE_AUTH_COOKIE.test(n)),
  };
});

vi.mock('@/modules/account-lifecycle', async () => {
  const actual = await vi.importActual<typeof AccountLifecycleModule>(
    '@/modules/account-lifecycle',
  );
  return {
    ...actual,
    getAccountStatus: getAccountStatusMock,
  };
});

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]): void => {
      errorLogMock(...args);
    },
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  redactPaths: [],
}));

beforeEach(() => {
  getUserMock.mockReset();
  getAccountStatusMock.mockReset();
  errorLogMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

const SEED_USER = { id: '00000000-0000-4000-8000-000000000abc', email: 'matrix@example.com' };

function asAnon(): void {
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
}

function asAuthWithStatus(status: AccountStatus): void {
  getUserMock.mockResolvedValue({ data: { user: SEED_USER }, error: null });
  getAccountStatusMock.mockResolvedValue({ status, source: 'db', drift: false });
}

function asAuthWithoutProfile(): void {
  getUserMock.mockResolvedValue({ data: { user: SEED_USER }, error: null });
  getAccountStatusMock.mockResolvedValue({ status: null, source: 'db', drift: false });
}

function asAuthStatusThrows(): void {
  getUserMock.mockResolvedValue({ data: { user: SEED_USER }, error: null });
  getAccountStatusMock.mockRejectedValue(new Error('db unreachable'));
}

// Build a NextRequest with optional Supabase auth cookies present, so the
// suspended/cancelled paths have something to delete.
function makeRequest(path: string, withSupabaseCookie = false): NextRequest {
  const url = `http://localhost${path}`;
  if (!withSupabaseCookie) {
    return new NextRequest(url);
  }
  // Two chunked auth cookies + one unrelated cookie. The cookie clear
  // should target both `sb-*-auth-token.*` names and leave the unrelated
  // cookie alone.
  return new NextRequest(url, {
    headers: {
      cookie: 'sb-localhost-auth-token.0=part-a; sb-localhost-auth-token.1=part-b; theme=dark',
    },
  });
}

function parseLocation(response: Response): URL {
  const loc = response.headers.get('location');
  if (!loc) throw new Error('expected a Location header on the response');
  return new URL(loc, 'http://localhost');
}

// `NextResponse.cookies.delete(name)` writes a `Set-Cookie: <name>=; Max-Age=0`
// header. We parse the multi-value Set-Cookie header so a single test can
// confirm BOTH chunks of an auth-token cookie were deleted in one pass.
function setCookieHeaders(response: Response): string[] {
  const single = response.headers.get('set-cookie');
  if (!single) return [];
  // Multiple Set-Cookie headers are comma-joined by `headers.get`. We can
  // reliably split on `, ` only when no Expires / SameSite values contain
  // a comma — Supabase delete cookies don't, so this is safe in practice.
  // For full correctness when the helper supports multi-getAll, prefer that.
  const all = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (Array.isArray(all)) return all;
  return single.split(/,\s*(?=[^=]+=)/);
}

function deletedCookieNames(response: Response): string[] {
  return setCookieHeaders(response)
    .filter((h) => /Max-Age=0|Max-Age=-1|Expires=Thu, 01 Jan 1970/i.test(h))
    .map((h) => h.split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

describe('middleware status × path matrix', () => {
  // Helper: load the middleware module fresh for each test. Without this,
  // the mocks from `vi.mock` are shared across tests but module state
  // (e.g., closures over the imported symbols) would persist if we cached
  // a single import — `resetModules` in `afterEach` flushes that cache.
  async function load() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  describe('anonymous requests', () => {
    it.each([
      ['/dashboard', '/dashboard'],
      ['/dashboard/foo', '/dashboard/foo'],
      ['/dashboard/foo?bar=1', '/dashboard/foo?bar=1'],
    ])('redirects %s to /login with redirectTo=%s', async (path, expectedRedirectTo) => {
      asAnon();
      const middleware = await load();
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe(expectedRedirectTo);
    });

    it.each(['/login', '/signup', '/auth/verify-email', '/auth/crp-review'])(
      '%s passes through (cookie-refresh response, no redirect)',
      async (path) => {
        asAnon();
        const middleware = await load();
        const response = await middleware(makeRequest(path));

        expect(response.headers.get('location')).toBeNull();
        expect(response.status).toBeLessThan(300);
      },
    );

    it.each(['/auth/callback', '/auth/callback?code=anything', '/api/health', '/api/me', '/'])(
      '%s passes through (always-passthrough surface)',
      async (path) => {
        asAnon();
        const middleware = await load();
        const response = await middleware(makeRequest(path));

        expect(response.headers.get('location')).toBeNull();
        expect(response.status).toBeLessThan(300);
      },
    );
  });

  // The 5 × 5 status × path matrix. We pick a representative path per
  // category and exhaustive statuses, plus crossed-bloqueante checks (e.g.
  // pending_verification on /auth/crp-review).
  describe('authenticated requests — /dashboard', () => {
    it('active passes through', async () => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest('/dashboard'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('pending_verification redirects to /auth/verify-email', async () => {
      asAuthWithStatus('pending_verification');
      const response = await (await load())(makeRequest('/dashboard'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/verify-email');
    });

    it('pending_crp_validation redirects to /auth/crp-review', async () => {
      asAuthWithStatus('pending_crp_validation');
      const response = await (await load())(makeRequest('/dashboard'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/crp-review');
    });

    it('suspended clears cookies and redirects to /login?reason=suspended', async () => {
      asAuthWithStatus('suspended');
      const response = await (await load())(makeRequest('/dashboard', true));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('suspended');
      // Both chunked auth cookies should be deleted.
      const deleted = deletedCookieNames(response);
      expect(deleted).toEqual(
        expect.arrayContaining(['sb-localhost-auth-token.0', 'sb-localhost-auth-token.1']),
      );
      // Unrelated cookie was NOT deleted.
      expect(deleted).not.toContain('theme');
    });

    it('cancelled clears cookies and redirects to /login?reason=cancelled', async () => {
      asAuthWithStatus('cancelled');
      const response = await (await load())(makeRequest('/dashboard', true));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('cancelled');
      const deleted = deletedCookieNames(response);
      expect(deleted).toEqual(
        expect.arrayContaining(['sb-localhost-auth-token.0', 'sb-localhost-auth-token.1']),
      );
    });
  });

  describe('authenticated requests — /login', () => {
    it('active redirects to /dashboard', async () => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest('/login'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('pending_verification redirects to /auth/verify-email', async () => {
      asAuthWithStatus('pending_verification');
      const response = await (await load())(makeRequest('/login'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/verify-email');
    });

    it('pending_crp_validation redirects to /auth/crp-review', async () => {
      asAuthWithStatus('pending_crp_validation');
      const response = await (await load())(makeRequest('/login'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/crp-review');
    });

    it('suspended clears cookies and redirects to /login?reason=suspended', async () => {
      asAuthWithStatus('suspended');
      const response = await (await load())(makeRequest('/login', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('suspended');
      expect(deletedCookieNames(response)).toEqual(
        expect.arrayContaining(['sb-localhost-auth-token.0']),
      );
    });

    it('cancelled clears cookies and redirects to /login?reason=cancelled', async () => {
      asAuthWithStatus('cancelled');
      const response = await (await load())(makeRequest('/login', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('cancelled');
    });
  });

  describe('authenticated requests — /signup', () => {
    it('active redirects to /dashboard', async () => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest('/signup'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('pending_verification redirects to /auth/verify-email', async () => {
      asAuthWithStatus('pending_verification');
      const response = await (await load())(makeRequest('/signup'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/verify-email');
    });

    it('pending_crp_validation redirects to /auth/crp-review', async () => {
      asAuthWithStatus('pending_crp_validation');
      const response = await (await load())(makeRequest('/signup'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/crp-review');
    });

    it('suspended clears cookies and redirects to /login?reason=suspended', async () => {
      asAuthWithStatus('suspended');
      const response = await (await load())(makeRequest('/signup', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('suspended');
    });

    it('cancelled clears cookies and redirects to /login?reason=cancelled', async () => {
      asAuthWithStatus('cancelled');
      const response = await (await load())(makeRequest('/signup', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('cancelled');
    });
  });

  describe('authenticated requests — /auth/verify-email', () => {
    it('active redirects to /dashboard (already past both gates)', async () => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest('/auth/verify-email'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('pending_verification renders the page (passthrough)', async () => {
      asAuthWithStatus('pending_verification');
      const response = await (await load())(makeRequest('/auth/verify-email'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('pending_crp_validation redirects to /auth/crp-review (correct gate)', async () => {
      asAuthWithStatus('pending_crp_validation');
      const response = await (await load())(makeRequest('/auth/verify-email'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/crp-review');
    });

    it('suspended clears cookies and redirects to /login?reason=suspended', async () => {
      asAuthWithStatus('suspended');
      const response = await (await load())(makeRequest('/auth/verify-email', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('suspended');
    });

    it('cancelled clears cookies and redirects to /login?reason=cancelled', async () => {
      asAuthWithStatus('cancelled');
      const response = await (await load())(makeRequest('/auth/verify-email', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('cancelled');
    });
  });

  describe('authenticated requests — /auth/crp-review', () => {
    it('active redirects to /dashboard', async () => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest('/auth/crp-review'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('pending_verification redirects to /auth/verify-email (correct gate)', async () => {
      asAuthWithStatus('pending_verification');
      const response = await (await load())(makeRequest('/auth/crp-review'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/auth/verify-email');
    });

    it('pending_crp_validation renders the page (passthrough)', async () => {
      asAuthWithStatus('pending_crp_validation');
      const response = await (await load())(makeRequest('/auth/crp-review'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('suspended clears cookies and redirects to /login?reason=suspended', async () => {
      asAuthWithStatus('suspended');
      const response = await (await load())(makeRequest('/auth/crp-review', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('suspended');
    });

    it('cancelled clears cookies and redirects to /login?reason=cancelled', async () => {
      asAuthWithStatus('cancelled');
      const response = await (await load())(makeRequest('/auth/crp-review', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('cancelled');
    });
  });

  describe('always-passthrough surfaces (never redirect, regardless of auth state)', () => {
    it.each([
      ['/auth/callback'],
      ['/auth/callback?code=anything'],
      ['/auth/callback/something'],
      ['/api/health'],
      ['/api/me'],
      ['/'],
    ])('%s passes through for an authenticated active user', async (path) => {
      asAuthWithStatus('active');
      const response = await (await load())(makeRequest(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('does not call getAccountStatus for /auth/callback (handler owns post-exchange routing)', async () => {
      asAuthWithStatus('active');
      const middleware = await load();
      await middleware(makeRequest('/auth/callback?code=x'));
      expect(getAccountStatusMock).not.toHaveBeenCalled();
    });

    it('does not call getAccountStatus for /api/* paths', async () => {
      asAuthWithStatus('active');
      const middleware = await load();
      await middleware(makeRequest('/api/health'));
      expect(getAccountStatusMock).not.toHaveBeenCalled();
    });
  });

  describe('orphan session — authenticated user with no profile row', () => {
    it('clears cookies and redirects to /login?reason=profile_missing on /dashboard', async () => {
      asAuthWithoutProfile();
      const response = await (await load())(makeRequest('/dashboard', true));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('profile_missing');
      expect(deletedCookieNames(response)).toEqual(
        expect.arrayContaining(['sb-localhost-auth-token.0']),
      );
    });

    it('clears cookies on /login as well (orphan must not see the form either)', async () => {
      asAuthWithoutProfile();
      const response = await (await load())(makeRequest('/login', true));
      expect(response.status).toBe(307);
      expect(parseLocation(response).searchParams.get('reason')).toBe('profile_missing');
    });
  });

  describe('getAccountStatus throws — fail-closed for app routes, passthrough for public', () => {
    it('redirects /dashboard to /login?redirectTo=%2Fdashboard (treats as anonymous)', async () => {
      asAuthStatusThrows();
      const response = await (await load())(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
      // Error must be logged so SRE has a signal.
      expect(errorLogMock).toHaveBeenCalledTimes(1);
    });

    it('passes through /login when status read fails (the form can render)', async () => {
      asAuthStatusThrows();
      const response = await (await load())(makeRequest('/login'));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
      expect(errorLogMock).toHaveBeenCalledTimes(1);
    });
  });
});
