import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware gates the onboarding WIZARD
// routes (`/onboarding/welcome` and `/onboarding/setup*`). These routes are NEW
// within the (app) route group; the classifier resolves them to the `'app'`
// (gated) class via the strict prefix+separator check.
//
// The wizard is deliberately gated like the rest of the `(app)` shell, NOT like
// `/onboarding/pending`: a `pending_*` user PASSES on `/onboarding/pending` but
// must be BOUNCED to `/onboarding/pending` when hitting the wizard (the wizard
// is only reachable once the account is `active`).
//
// Coverage (per specs/middleware-gating/spec.md):
//   - Anonymous -> 307 to /login?redirectTo=<path> (negative-auth proof).
//   - Active user -> pass through.
//   - Pending (pending_crp_validation) user -> bounced to /onboarding/pending.
//   - Near-miss `/onboarding/welcomex` -> NOT gated (falls through to public).

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

interface OnboardingOverrides {
  onboardingStep?: string;
  onboardingCompletedAt?: Date | null;
}

function profileWithStatus(status: ProfileStatus, onboarding: OnboardingOverrides = {}) {
  return {
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
    requiresPasswordReset: false,
    onboardingStep: onboarding.onboardingStep ?? 'welcome',
    onboardingCompletedAt: onboarding.onboardingCompletedAt ?? null,
    firstAccessAt: null,
    reactivatedAt: null,
    npsScore: null,
    npsFeedback: null,
    npsRespondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function asActiveUser() {
  // active + !requires_password_reset, onboarding COMPLETE (step='done').
  // The middleware resolves the profile and never calls getUser() again, so
  // only the profile mock matters. A complete onboarding is required for the
  // wizard routes to bounce to /dashboard.
  getCurrentProfileEdgeMock.mockResolvedValue(
    profileWithStatus(ProfileStatus.Active, { onboardingStep: 'done' }),
  );
}

function asActiveIncompleteUser() {
  // active + !requires_password_reset, onboarding INCOMPLETE (step='welcome',
  // no completion timestamp). Such a user is funneled into the first-run wizard.
  getCurrentProfileEdgeMock.mockResolvedValue(
    profileWithStatus(ProfileStatus.Active, {
      onboardingStep: 'welcome',
      onboardingCompletedAt: null,
    }),
  );
}

function asPendingUser() {
  getCurrentProfileEdgeMock.mockResolvedValue(
    profileWithStatus(ProfileStatus.PendingCrpValidation),
  );
}

function asSuspendedUser() {
  getCurrentProfileEdgeMock.mockResolvedValue(profileWithStatus(ProfileStatus.Suspended));
}

function asCancelledUser() {
  getCurrentProfileEdgeMock.mockResolvedValue(profileWithStatus(ProfileStatus.Cancelled));
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
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

// -- Paths under test ---------------------------------------------------------

const WELCOME_PATH = '/onboarding/welcome';
const SETUP_PROFILE_PATH = '/onboarding/setup/profile';
const NEAR_MISS_PATH = '/onboarding/welcomex';

// -- Tests --------------------------------------------------------------------

describe('middleware onboarding wizard route gating', () => {
  // =====================================================================
  // Negative-auth: anonymous requests redirect to /login?redirectTo=<path>
  // =====================================================================
  describe('anonymous -> redirect to /login', () => {
    it.each([
      { path: SETUP_PROFILE_PATH, label: 'setup/profile subpath' },
      { path: WELCOME_PATH, label: 'welcome page' },
    ])('$label redirects to /login with correct redirectTo', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe(path);
    });
  });

  // =====================================================================
  // Active + onboarding INCOMPLETE: passes through the wizard WITHOUT a loop.
  // This is the critical case -- the active-incomplete branch redirects every
  // other surface to /onboarding/welcome, so the wizard routes themselves MUST
  // pass or the redirect would target a path that redirects to itself.
  // =====================================================================
  describe('active + incomplete onboarding -> passes wizard without loop', () => {
    it.each([
      { path: WELCOME_PATH, label: 'welcome page' },
      { path: SETUP_PROFILE_PATH, label: 'setup/profile subpath' },
    ])('$label passes through (no loop)', async ({ path }) => {
      asActiveIncompleteUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Active + onboarding INCOMPLETE on a gated app route -> funneled to wizard.
  // =====================================================================
  describe('active + incomplete onboarding on /dashboard -> redirect to wizard', () => {
    it.each([
      { path: '/dashboard', label: 'dashboard root' },
      { path: '/agenda', label: 'agenda' },
    ])('$label redirects to /onboarding/welcome', async ({ path }) => {
      asActiveIncompleteUser();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/onboarding/welcome');
    });
  });

  // =====================================================================
  // Active + onboarding COMPLETE (step='done', i.e. finished OR skipped):
  //   - the app shell passes,
  //   - the now-finished wizard bounces to /dashboard (soft gate opened).
  // =====================================================================
  describe('active + complete onboarding', () => {
    it('reaches /agenda normally (app shell passes)', async () => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest('/agenda')));
    });

    it.each([
      { path: WELCOME_PATH, label: 'welcome page' },
      { path: SETUP_PROFILE_PATH, label: 'setup/profile subpath' },
    ])('$label bounces to /dashboard (wizard already done)', async ({ path }) => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/dashboard');
    });

    it('treats a stamped onboardingCompletedAt as complete even if step != done', async () => {
      getCurrentProfileEdgeMock.mockResolvedValue(
        profileWithStatus(ProfileStatus.Active, {
          onboardingStep: 'setup',
          onboardingCompletedAt: new Date(),
        }),
      );
      const { middleware } = await import('@/middleware');
      // app shell passes -> onboarding considered complete via the timestamp.
      expectPass(await middleware(makeRequest('/dashboard')));
    });
  });

  // =====================================================================
  // Pending user -> bounced to /onboarding/pending (wizard not yet reachable)
  // =====================================================================
  describe('pending user -> redirect to /onboarding/pending', () => {
    it.each([
      { path: SETUP_PROFILE_PATH, label: 'setup/profile subpath' },
      { path: WELCOME_PATH, label: 'welcome page' },
    ])('$label bounces a pending user to /onboarding/pending', async ({ path }) => {
      asPendingUser();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/onboarding/pending');
    });
  });

  // =====================================================================
  // Near-miss: `/onboarding/welcomex` is NOT gated by the strict check
  // =====================================================================
  describe('near-miss prefix is not gated by accident', () => {
    it('passes /onboarding/welcomex through for an anonymous client', async () => {
      // If `/onboarding/welcomex` were (wrongly) classified as gated, an anon
      // request would 307 to /login. The strict prefix+separator check keeps it
      // in the `'public'` class, so an anonymous request passes through.
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(NEAR_MISS_PATH)));
    });
  });

  // =====================================================================
  // Suspended / cancelled: the wizard class is treated like the `'app'` shell
  // -- the session cookie is cleared and the user is bounced to /login.
  // =====================================================================
  describe('suspended/cancelled -> clear cookie + redirect to /login', () => {
    it.each([
      { make: asSuspendedUser, label: 'suspended', path: WELCOME_PATH },
      { make: asCancelledUser, label: 'cancelled', path: SETUP_PROFILE_PATH },
    ])('$label on wizard route clears session and redirects to /login', async ({ make, path }) => {
      make();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      // The clear-and-redirect path must call signOut to invalidate the session
      // server-side before bouncing -- otherwise the next request loops.
      expect(signOutMock).toHaveBeenCalled();
    });
  });
});
