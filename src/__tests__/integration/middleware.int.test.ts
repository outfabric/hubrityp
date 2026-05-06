import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We import `ProfileStatus` from the canonical barrel for ergonomics —
// it's a pure value enum, doesn't pull Drizzle, and the unit-test stack
// resolves the alias correctly. The middleware itself imports from
// `@/modules/registration/edge` (Edge-safe surface) and that's the path
// `vi.mock` targets below.
import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Root-middleware behaviour is exercised against mocked module boundaries:
//   • `@/shared/supabase/middleware`  → returns a fake `supabase` shim and a
//     plain NextResponse, so we don't boot GoTrue.
//   • `getCurrentProfileEdge` is replaced via a spy so each test can stage
//     a profile with a specific `status` (or `null` for anonymous).
//
// The middleware itself runs unmocked — these tests pin the gating
// contract from `specs/authentication/spec.md` (Requirement: Middleware
// enforces auth gating for `(app)` routes), with a row per status × path
// combination from the decision table.
//
// We assert the Location header by parsing it back into a `URL`, since
// `NextResponse.redirect()` may serialize the value as an absolute URL.

// `vi.mock` factories are hoisted above top-level imports, but `const`
// declarations are NOT — so referencing a `vi.fn()` directly from a factory
// throws a TDZ error if a top-level import triggers eager evaluation of the
// mocked module (e.g. importing `ProfileStatus` from the registration
// barrel above forces the registration mock factory to run before the
// regular `vi.fn()` consts initialize). `vi.hoisted` fixes this by giving
// us a hoisted block whose return values ARE accessible inside the
// factories.
const { getUserMock, getCurrentProfileEdgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getCurrentProfileEdgeMock: vi.fn(),
}));

// `signOutMock` is a no-op spy — the suspended/cancelled fix asks the
// middleware to call `supabase.auth.signOut()` before redirecting/passing.
// The test asserts presence-of-call and that any `sb-*` cookie that was on
// the incoming request is explicitly deleted on the outgoing response.
const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: {
          auth: {
            getUser: getUserMock,
            signOut: signOutMock,
          },
        },
        response,
      };
    }),
  };
});

// We mock the Edge-only barrel because that's what the middleware imports.
// `importOriginal` preserves the rest of the surface — `ProfileStatus`
// (value enum) and `Profile` (type-only) — so test fixtures can keep
// using the real enum values for status comparisons.
vi.mock('@/modules/registration/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistrationEdgeModule>();
  return {
    ...actual,
    getCurrentProfileEdge: getCurrentProfileEdgeMock,
  };
});

beforeEach(() => {
  getUserMock.mockReset();
  getCurrentProfileEdgeMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetModules();
});

// Test fixtures.

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

// Authenticated session WITH a profile of the given status.
function asAuthWithStatus(status: ProfileStatus) {
  const userId = '00000000-0000-4000-8000-000000000001';
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: userId,
        email: 'doctor@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
      },
    },
    error: null,
  });
  getCurrentProfileEdgeMock.mockResolvedValue({
    userId,
    email: 'doctor@example.com',
    fullName: 'Dr. Test',
    crpNumber: '12345',
    crpUf: 'SP',
    crpValidatedAt: null,
    crpValidatedBy: null,
    emailVerifiedAt: null,
    status,
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
    sensitiveDataConsentAt: new Date(),
    lastResendAt: null,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockoutUntil: null,
    consecutiveLockouts: 0,
    requiresPasswordReset: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// Authenticated session but no profile row (email signup race window).
// Per spec this is treated identically to "no session" in the decision
// table. The `app_metadata.provider = 'email'` signals that this is NOT
// an OAuth user, so the middleware applies the "anonymous" column.
function asAuthWithoutProfile() {
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'doctor@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
      },
    },
    error: null,
  });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

function makeRequest(path: string, opts: { withSupabaseCookie?: boolean } = {}): NextRequest {
  const request = new NextRequest(`http://localhost${path}`);
  if (opts.withSupabaseCookie) {
    request.cookies.set('sb-localhost-auth-token', 'fake-token');
  }
  return request;
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

  describe('active user', () => {
    it('passes through on /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('is bounced from /login to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/dashboard');
      expect(url.search).toBe('');
    });

    it('is bounced from /signup to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/signup'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });

    it('is bounced from /onboarding/pending to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/dashboard');
    });
  });

  describe('pending_verification user', () => {
    it('is bounced from /login to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });

    it('is bounced from /signup to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/signup'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });

    it('passes through on /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('is bounced from /dashboard to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });
  });

  describe('pending_crp_validation user', () => {
    it('is bounced from /dashboard to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/onboarding/pending');
    });

    it('passes through on /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe.each([ProfileStatus.Suspended, ProfileStatus.Cancelled] as const)(
    '%s user',
    (status) => {
      it('is bounced from /dashboard to /login with the session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/dashboard', { withSupabaseCookie: true }));

        expect(response.status).toBe(307);
        expect(parseLocation(response).pathname).toBe('/login');
        // The fix for the redirect-loop CRÍTICO: middleware MUST sign out
        // the suspended session and emit cookie deletions on the redirect.
        expect(signOutMock).toHaveBeenCalledTimes(1);
        const tokenCookie = response.cookies.get('sb-localhost-auth-token');
        // `cookies.delete` produces a cookie entry with empty value and
        // `Max-Age=0` (or expires-in-the-past) — assert the expiration
        // signal rather than the absence (Next stores deletes as entries).
        expect(tokenCookie?.value ?? '').toBe('');
      });

      it('is bounced from /onboarding/pending to /login with the session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/onboarding/pending', { withSupabaseCookie: true }),
        );

        expect(response.status).toBe(307);
        expect(parseLocation(response).pathname).toBe('/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('lets /login through (no redirect loop) and clears the session cookie', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/login', { withSupabaseCookie: true }));

        // Pre-fix behaviour was a redirect to /login (self-loop). The CRÍTICO
        // fix: when status=suspended/cancelled and the path is the auth
        // surface itself, middleware passes through (so the form renders)
        // and clears the auth cookies. The next request is anonymous, so
        // `decide` falls back to the "no session" column and stays on
        // /login.
        expect(response.headers.get('location')).toBeNull();
        expect(response.status).toBeLessThan(300);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        const tokenCookie = response.cookies.get('sb-localhost-auth-token');
        expect(tokenCookie?.value ?? '').toBe('');
      });

      it('lets /signup through and clears the session cookie', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/signup', { withSupabaseCookie: true }));

        expect(response.headers.get('location')).toBeNull();
        expect(response.status).toBeLessThan(300);
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });
    },
  );

  describe('/auth/callback always passes through', () => {
    it.each([
      { label: 'anonymous', setup: asAnon },
      {
        label: 'pending_verification',
        setup: () => asAuthWithStatus(ProfileStatus.PendingVerification),
      },
      { label: 'active', setup: () => asAuthWithStatus(ProfileStatus.Active) },
      { label: 'suspended', setup: () => asAuthWithStatus(ProfileStatus.Suspended) },
    ])('passes through for $label session', async ({ setup }) => {
      setup();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/auth/callback?code=abc'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
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

    it('lets anonymous /login through (so the form can render)', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/login'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });

    it('lets anonymous /signup through (so the form can render)', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/signup'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    });
  });

  describe('authenticated user without profile row (race window)', () => {
    it('is treated as anonymous for /dashboard', async () => {
      asAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    });

    it('lets /login through (since the user has no profile yet)', async () => {
      asAuthWithoutProfile();
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
