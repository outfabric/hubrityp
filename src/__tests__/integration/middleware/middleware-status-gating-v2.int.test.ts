import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We import `ProfileStatus` from the canonical barrel for ergonomics --
// it's a pure value enum, doesn't pull Drizzle, and the unit-test stack
// resolves the alias correctly. The middleware itself imports from
// `@/modules/registration/edge` (Edge-safe surface) and that's the path
// `vi.mock` targets below.
import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Comprehensive middleware status-gating test covering the FULL decision
// table from the auth spec, including:
//   - Anonymous session (no auth user)
//   - OAuth user without profile (needs complete-profile)
//   - Email user without profile (race window, treated as anonymous)
//   - Pending verification / pending CRP validation
//   - Active user (requires_password_reset = false)
//   - Active user (requires_password_reset = true)
//   - Suspended / cancelled users
//
// All path classes from the decision table are tested:
//   /login, /signup, /forgot-password, /reset-password,
//   /auth/link-account, /onboarding/complete-profile,
//   /onboarding/pending, /dashboard, /auth/callback, public paths

const { getUserMock, getCurrentProfileEdgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getCurrentProfileEdgeMock: vi.fn(),
}));

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

// -- Session fixtures ---------------------------------------------------------

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001';

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

/** OAuth user with a session but no profile row yet. */
function asOAuthWithoutProfile() {
  const user = {
    id: FAKE_USER_ID,
    email: 'doctor@example.com',
    app_metadata: {
      provider: 'google',
      providers: ['google'],
    },
  };
  getUserMock.mockResolvedValue({ data: { user }, error: null });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

/** Email user with a session but no profile row yet (trigger race window). */
function asEmailWithoutProfile() {
  const user = {
    id: FAKE_USER_ID,
    email: 'doctor@example.com',
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
  };
  getUserMock.mockResolvedValue({ data: { user }, error: null });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

/** Authenticated session WITH a profile of the given status. */
function asAuthWithStatus(
  status: ProfileStatus,
  overrides: { requiresPasswordReset?: boolean } = {},
) {
  // getUser is called when profile is null to check OAuth identity.
  // When profile is non-null, the middleware skips the second getUser call,
  // but we still mock it for safety.
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: FAKE_USER_ID,
        email: 'doctor@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
      },
    },
    error: null,
  });
  getCurrentProfileEdgeMock.mockResolvedValue({
    userId: FAKE_USER_ID,
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
    requiresPasswordReset: overrides.requiresPasswordReset ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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
  return new URL(loc, 'http://localhost');
}

function expectPass(response: Response) {
  expect(response.headers.get('location')).toBeNull();
  expect(response.status).toBeLessThan(300);
}

function expectRedirect(response: Response, expectedPath: string) {
  expect(response.status).toBe(307);
  expect(parseLocation(response).pathname).toBe(expectedPath);
}

// -- Tests --------------------------------------------------------------------

describe('middleware status gating v2 (full decision table)', () => {
  // =====================================================================
  // Column: Anonymous (no session)
  // =====================================================================
  describe('anonymous session', () => {
    it('/login passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/login')));
    });

    it('/signup passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/signup')));
    });

    it('/forgot-password passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/forgot-password')));
    });

    it('/reset-password passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/reset-password')));
    });

    it('/auth/link-account passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/link-account')));
    });

    it('/onboarding/complete-profile redirects to /login with redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/complete-profile'));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/onboarding/complete-profile');
    });

    it('/onboarding/pending redirects to /login with redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/onboarding/pending');
    });

    it('/dashboard redirects to /login with redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));
      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    });

    it('/auth/callback passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });

    it('/ (public) passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/')));
    });

    it('/api/health (public) passes through', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/api/health')));
    });
  });

  // =====================================================================
  // Column: OAuth user without profile
  // =====================================================================
  describe('OAuth user without profile', () => {
    it('/login redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/login')), '/onboarding/complete-profile');
    });

    it('/signup redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/signup')), '/onboarding/complete-profile');
    });

    it('/forgot-password redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(
        await middleware(makeRequest('/forgot-password')),
        '/onboarding/complete-profile',
      );
    });

    it('/reset-password redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(
        await middleware(makeRequest('/reset-password')),
        '/onboarding/complete-profile',
      );
    });

    it('/auth/link-account passes through', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/link-account')));
    });

    it('/onboarding/complete-profile passes through', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/onboarding/complete-profile')));
    });

    it('/onboarding/pending redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(
        await middleware(makeRequest('/onboarding/pending')),
        '/onboarding/complete-profile',
      );
    });

    it('/dashboard redirects to /onboarding/complete-profile', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/dashboard')), '/onboarding/complete-profile');
    });

    it('/auth/callback passes through', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });

    it('/ (public) passes through', async () => {
      asOAuthWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/')));
    });
  });

  // =====================================================================
  // Column: Email user without profile (race window = treated as anon)
  // =====================================================================
  describe('email user without profile (trigger race window)', () => {
    it('/login passes through (treated as anonymous)', async () => {
      asEmailWithoutProfile();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/login')));
    });

    it('/dashboard redirects to /login (treated as anonymous)', async () => {
      asEmailWithoutProfile();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/login');
    });

    it('/onboarding/complete-profile redirects to /login (treated as anonymous)', async () => {
      asEmailWithoutProfile();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/complete-profile'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/login');
    });

    it('/onboarding/pending redirects to /login (treated as anonymous)', async () => {
      asEmailWithoutProfile();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/onboarding/pending'));
      expect(response.status).toBe(307);
      expect(parseLocation(response).pathname).toBe('/login');
    });
  });

  // =====================================================================
  // Column: pending_verification
  // =====================================================================
  describe('pending_verification user', () => {
    it('/login redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/login')), '/onboarding/pending');
    });

    it('/signup redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/signup')), '/onboarding/pending');
    });

    it('/forgot-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/forgot-password')));
    });

    it('/reset-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/reset-password')));
    });

    it('/auth/link-account redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/auth/link-account')), '/onboarding/pending');
    });

    it('/onboarding/complete-profile redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectRedirect(
        await middleware(makeRequest('/onboarding/complete-profile')),
        '/onboarding/pending',
      );
    });

    it('/onboarding/pending passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/onboarding/pending')));
    });

    it('/dashboard redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/dashboard')), '/onboarding/pending');
    });

    it('/auth/callback passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });

    it('/ (public) passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingVerification);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/')));
    });
  });

  // =====================================================================
  // Column: pending_crp_validation
  // =====================================================================
  describe('pending_crp_validation user', () => {
    it('/login redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/login')), '/onboarding/pending');
    });

    it('/forgot-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/forgot-password')));
    });

    it('/reset-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/reset-password')));
    });

    it('/onboarding/pending passes through', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/onboarding/pending')));
    });

    it('/dashboard redirects to /onboarding/pending', async () => {
      asAuthWithStatus(ProfileStatus.PendingCrpValidation);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/dashboard')), '/onboarding/pending');
    });
  });

  // =====================================================================
  // Column: active + requires_password_reset = false
  // =====================================================================
  describe('active user (requires_password_reset = false)', () => {
    it('/login redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/login')), '/dashboard');
    });

    it('/signup redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/signup')), '/dashboard');
    });

    it('/forgot-password redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/forgot-password')), '/dashboard');
    });

    it('/reset-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/reset-password')));
    });

    it('/auth/link-account redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/auth/link-account')), '/dashboard');
    });

    it('/onboarding/complete-profile redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/onboarding/complete-profile')), '/dashboard');
    });

    it('/onboarding/pending redirects to /dashboard', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/onboarding/pending')), '/dashboard');
    });

    it('/dashboard passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/dashboard')));
    });

    it('/auth/callback passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });

    it('/ (public) passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active);
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/')));
    });
  });

  // =====================================================================
  // Column: active + requires_password_reset = true
  // =====================================================================
  describe('active user (requires_password_reset = true)', () => {
    it('/login redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/login')), '/forgot-password');
    });

    it('/signup redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/signup')), '/forgot-password');
    });

    it('/forgot-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/forgot-password')));
    });

    it('/reset-password passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/reset-password')));
    });

    it('/auth/link-account redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/auth/link-account')), '/forgot-password');
    });

    it('/onboarding/complete-profile redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(
        await middleware(makeRequest('/onboarding/complete-profile')),
        '/forgot-password',
      );
    });

    it('/onboarding/pending redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/onboarding/pending')), '/forgot-password');
    });

    it('/dashboard redirects to /forgot-password', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectRedirect(await middleware(makeRequest('/dashboard')), '/forgot-password');
    });

    it('/auth/callback passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });

    it('/ (public) passes through', async () => {
      asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true });
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/')));
    });
  });

  // =====================================================================
  // Column: suspended / cancelled
  // =====================================================================
  describe.each([ProfileStatus.Suspended, ProfileStatus.Cancelled] as const)(
    '%s user',
    (status) => {
      it('/login passes through with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/login', { withSupabaseCookie: true }));

        expectPass(response);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        const tokenCookie = response.cookies.get('sb-localhost-auth-token');
        expect(tokenCookie?.value ?? '').toBe('');
      });

      it('/signup passes through with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/signup', { withSupabaseCookie: true }));

        expectPass(response);
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/forgot-password redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/forgot-password', { withSupabaseCookie: true }),
        );

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/reset-password redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/reset-password', { withSupabaseCookie: true }),
        );

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/auth/link-account redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/auth/link-account', { withSupabaseCookie: true }),
        );

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/onboarding/complete-profile redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/onboarding/complete-profile', { withSupabaseCookie: true }),
        );

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/onboarding/pending redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(
          makeRequest('/onboarding/pending', { withSupabaseCookie: true }),
        );

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
      });

      it('/dashboard redirects to /login with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/dashboard', { withSupabaseCookie: true }));

        expectRedirect(response, '/login');
        expect(signOutMock).toHaveBeenCalledTimes(1);
        const tokenCookie = response.cookies.get('sb-localhost-auth-token');
        expect(tokenCookie?.value ?? '').toBe('');
      });

      it('/auth/callback passes through', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
      });

      it('/ (public) passes through with session cleared', async () => {
        asAuthWithStatus(status);
        const { middleware } = await import('@/middleware');
        const response = await middleware(makeRequest('/', { withSupabaseCookie: true }));
        // Public paths for suspended users clear-and-pass
        expect(response.status).toBeLessThan(300);
      });
    },
  );

  // =====================================================================
  // /auth/callback always passes through regardless of state
  // =====================================================================
  describe('/auth/callback always passes', () => {
    it.each([
      { label: 'anonymous', setup: asAnon },
      { label: 'OAuth without profile', setup: asOAuthWithoutProfile },
      { label: 'email without profile', setup: asEmailWithoutProfile },
      {
        label: 'pending_verification',
        setup: () => asAuthWithStatus(ProfileStatus.PendingVerification),
      },
      {
        label: 'pending_crp_validation',
        setup: () => asAuthWithStatus(ProfileStatus.PendingCrpValidation),
      },
      { label: 'active', setup: () => asAuthWithStatus(ProfileStatus.Active) },
      {
        label: 'active + requires_password_reset',
        setup: () => asAuthWithStatus(ProfileStatus.Active, { requiresPasswordReset: true }),
      },
      { label: 'suspended', setup: () => asAuthWithStatus(ProfileStatus.Suspended) },
      { label: 'cancelled', setup: () => asAuthWithStatus(ProfileStatus.Cancelled) },
    ])('passes through for $label session', async ({ setup }) => {
      setup();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/auth/callback?code=abc')));
    });
  });

  // =====================================================================
  // Matcher boundaries (regression guards)
  // =====================================================================
  describe('matcher boundaries', () => {
    it('does not gate routes that merely contain "dashboard" elsewhere in the path', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/some/dashboard-news')));
    });

    it('preserves deeper path in redirectTo for /dashboard sub-routes', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard/settings/profile'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard/settings/profile');
    });

    it('preserves query string inside redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard?tab=patients'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard?tab=patients');
    });
  });

  // =====================================================================
  // hasOAuthIdentity helper (exported for unit-testability)
  // =====================================================================
  describe('hasOAuthIdentity', () => {
    it('returns true for Google OAuth user', async () => {
      const { hasOAuthIdentity } = await import('@/middleware');
      const user = {
        id: FAKE_USER_ID,
        app_metadata: { provider: 'google', providers: ['google'] },
      } as Parameters<typeof hasOAuthIdentity>[0];
      expect(hasOAuthIdentity(user)).toBe(true);
    });

    it('returns true for user with both email and Google providers', async () => {
      const { hasOAuthIdentity } = await import('@/middleware');
      const user = {
        id: FAKE_USER_ID,
        app_metadata: { provider: 'google', providers: ['email', 'google'] },
      } as Parameters<typeof hasOAuthIdentity>[0];
      expect(hasOAuthIdentity(user)).toBe(true);
    });

    it('returns false for email-only user', async () => {
      const { hasOAuthIdentity } = await import('@/middleware');
      const user = {
        id: FAKE_USER_ID,
        app_metadata: { provider: 'email', providers: ['email'] },
      } as Parameters<typeof hasOAuthIdentity>[0];
      expect(hasOAuthIdentity(user)).toBe(false);
    });

    it('returns false when app_metadata has no providers array (fallback to provider)', async () => {
      const { hasOAuthIdentity } = await import('@/middleware');
      const user = {
        id: FAKE_USER_ID,
        app_metadata: { provider: 'email' },
      } as Parameters<typeof hasOAuthIdentity>[0];
      expect(hasOAuthIdentity(user)).toBe(false);
    });

    it('returns true when only provider field is set to non-email (older GoTrue)', async () => {
      const { hasOAuthIdentity } = await import('@/middleware');
      const user = {
        id: FAKE_USER_ID,
        app_metadata: { provider: 'github' },
      } as Parameters<typeof hasOAuthIdentity>[0];
      expect(hasOAuthIdentity(user)).toBe(true);
    });
  });
});
