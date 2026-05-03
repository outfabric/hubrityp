import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AccountLifecycleModule from '@/modules/account-lifecycle';

// Root-middleware behaviour is exercised against a mocked
// `createMiddlewareClient` and a mocked `getAccountStatus` so each test can
// stage either an authenticated session (`{ data: { user: <user> } }`) or an
// anonymous session (`{ data: { user: null } }`) without booting GoTrue or
// hitting the database. The middleware itself runs unmocked — these tests
// pin the high-level gating contract from `specs/authentication/spec.md`:
//
//   • anon  → /dashboard*       → 307 to /login?redirectTo=<encoded>
//   • auth (active) → /login    → 307 to /dashboard
//   • anon  → /api/health, /    → no redirect (cookie-refresh response)
//
// The full status × path matrix (5 × 5) lives in
// `middleware-status.int.test.ts` — this file keeps the original section-3
// auth-gating coverage as a regression backstop and asserts only the
// happy-path active behaviour for authenticated cases. New status branches
// MUST be added to the matrix file, not here, to keep this file's scope
// focused on the core anonymous-gating + active passthrough contract.
//
// We assert the Location header by parsing it back into a `URL`, since
// `NextResponse.redirect()` may serialize the value as an absolute URL.

const getUserMock = vi.fn();
const getAccountStatusMock = vi.fn();
const clearSupabaseAuthCookiesMock = vi.fn();

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: {
          auth: {
            getUser: getUserMock,
          },
        },
        response,
      };
    }),
    // The middleware imports this helper for the suspended/cancelled and
    // orphan-session redirects. The active-only happy path in this file
    // never triggers it, but the import must resolve to *something*.
    clearSupabaseAuthCookies: clearSupabaseAuthCookiesMock,
    findSupabaseAuthCookieNames: vi.fn(() => [] as string[]),
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

beforeEach(() => {
  getUserMock.mockReset();
  getAccountStatusMock.mockReset();
  clearSupabaseAuthCookiesMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
}

function asAuth() {
  getUserMock.mockResolvedValue({
    data: { user: { id: '00000000-0000-4000-8000-000000000001', email: 'doctor@example.com' } },
    error: null,
  });
  // Default to `active` for the legacy auth-gating tests below.
  getAccountStatusMock.mockResolvedValue({ status: 'active', source: 'db', drift: false });
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function parseLocation(response: Response): URL {
  const loc = response.headers.get('location');
  if (!loc) throw new Error('expected a Location header on the response');
  // Location may be relative or absolute depending on the runtime — `URL`
  // accepts both when given a base.
  return new URL(loc, 'http://localhost');
}

describe('middleware (integration)', () => {
  describe('anonymous on a gated /dashboard* route', () => {
    it('redirects /dashboard with redirectTo=%2Fdashboard', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    });

    it('preserves a deeper path in redirectTo (encoded)', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard/settings/profile'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard/settings/profile');
      // The raw header MUST contain the URL-encoded slashes — the spec
      // explicitly calls out `%2F` so a stricter URL parser elsewhere in the
      // pipeline cannot mis-route on a literal `/`.
      const rawLoc = response.headers.get('location') ?? '';
      expect(rawLoc).toContain('redirectTo=%2Fdashboard%2Fsettings%2Fprofile');
    });

    it('preserves the original query string inside redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard?tab=patients'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard?tab=patients');
    });
  });

  describe('authenticated active user on /login', () => {
    it('redirects to /dashboard', async () => {
      asAuth();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/dashboard');
      expect(url.search).toBe('');
    });
  });

  describe('public routes pass through', () => {
    it('lets anonymous /api/health through without a redirect', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/api/health'));

      // NextResponse.next() returns a 200-ish response with no Location
      // header — that's what "passes through" looks like. We pin both signals
      // (no Location, status not in 3xx) so a future regression that emits a
      // redirect on this path fails loudly.
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('lets anonymous / through without a redirect', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('lets active /dashboard through (no redirect — happy path)', async () => {
      asAuth();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('lets anonymous /login through (so the form can render)', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe('matcher boundaries', () => {
    it('does not gate routes that merely contain "dashboard" elsewhere in the path', async () => {
      // `/some/dashboard-news` is NOT a /dashboard* gated route. Only
      // `/dashboard` and `/dashboard/...` (a strict prefix with separator)
      // should redirect anon users.
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/some/dashboard-news'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });
});
