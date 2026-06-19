import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware classifies the public
// marketing + legal routes (`/`, `/precos`, `/politica-de-privacidade`,
// `/termos-de-uso`) as `public` for EVERY session state in the decision
// table. Public routes must never redirect an anonymous visitor, must never
// bounce an active user back into the app (homepage stays on `/`), and must
// clear-and-pass for suspended/cancelled accounts (cookie cleared, page still
// served). The near-miss path `/precos-internos` must NOT be falsely matched
// by the prefix check — it falls through to default-public, which still
// passes, but the test documents the substring-safety boundary.

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

function baseProfile(overrides: Partial<RegistrationEdgeModule.Profile>) {
  return {
    userId: FAKE_USER_ID,
    email: 'doctor@example.com',
    fullName: 'Dr. Test',
    crpNumber: '12345',
    crpUf: 'SP',
    crpValidatedAt: null,
    crpValidatedBy: null,
    emailVerifiedAt: null,
    status: ProfileStatus.Active,
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
    sensitiveDataConsentAt: new Date(),
    lastResendAt: null,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockoutUntil: null,
    consecutiveLockouts: 0,
    requiresPasswordReset: false,
    onboardingStep: 'complete',
    onboardingCompletedAt: null,
    tourCompletedAt: null,
    firstAccessAt: null,
    reactivatedAt: null,
    npsScore: null,
    npsFeedback: null,
    npsRespondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } satisfies RegistrationEdgeModule.Profile;
}

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

function asAuthedUser(profile: RegistrationEdgeModule.Profile) {
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
  getCurrentProfileEdgeMock.mockResolvedValue(profile);
}

function asPending() {
  asAuthedUser(baseProfile({ status: ProfileStatus.PendingVerification }));
}

function asActive() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Active, requiresPasswordReset: false }));
}

function asActiveRpr() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Active, requiresPasswordReset: true }));
}

function asSuspended() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Suspended }));
}

function asCancelled() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Cancelled }));
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function expectPass(response: Response) {
  expect(response.headers.get('location')).toBeNull();
  expect(response.status).toBeLessThan(300);
}

const PUBLIC_ROUTES = [
  { path: '/', label: '/ (homepage)' },
  { path: '/precos', label: '/precos' },
  { path: '/politica-de-privacidade', label: '/politica-de-privacidade' },
  { path: '/termos-de-uso', label: '/termos-de-uso' },
] as const;

// -- Tests --------------------------------------------------------------------

describe('middleware public marketing + legal routes gating', () => {
  // =====================================================================
  // Scenario 1: anonymous visitor reaches every public route -> pass
  // =====================================================================
  describe('anonymous -> pass (no redirect)', () => {
    it.each(PUBLIC_ROUTES)('$label passes through for anonymous user', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Scenario 2: pending and rpr users still reach public routes -> pass
  // =====================================================================
  describe('pending -> pass (no redirect to onboarding)', () => {
    it.each(PUBLIC_ROUTES)('$label passes through for pending user', async ({ path }) => {
      asPending();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  describe('active + requires_password_reset -> pass (no redirect to forgot-password)', () => {
    it.each(PUBLIC_ROUTES)('$label passes through for active+rpr user', async ({ path }) => {
      asActiveRpr();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Scenario 3: suspended/cancelled -> clear-and-pass
  // (cookie cleared, page served — NOT redirected to /login)
  // =====================================================================
  describe('suspended/cancelled -> clear-and-pass (cookie cleared, page served)', () => {
    it.each(PUBLIC_ROUTES)('$label clear-and-passes for suspended user', async ({ path }) => {
      asSuspended();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));
      expectPass(response);
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });

    it.each(PUBLIC_ROUTES)('$label clear-and-passes for cancelled user', async ({ path }) => {
      asCancelled();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));
      expectPass(response);
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });
  });

  // =====================================================================
  // Scenario 4: active user stays on the homepage (NOT -> /dashboard)
  // =====================================================================
  describe('active user is NOT redirected from marketing pages', () => {
    it.each(PUBLIC_ROUTES)('$label stays on the page for active user', async ({ path }) => {
      asActive();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));
      expectPass(response);
      // Explicit guard against the regression: an active user on a public
      // route must NOT be bounced to /dashboard.
      expect(response.headers.get('location')).toBeNull();
    });
  });

  // =====================================================================
  // Scenario 5: near-miss paths are NOT falsely matched (substring safety)
  // They still pass (default-public), but the strict prefix check means
  // they are matched by the default fallthrough, not the marketing prefix.
  // =====================================================================
  describe('boundary: near-miss prefixes are not falsely matched', () => {
    it.each([
      { path: '/precos-internos', label: '/precos-internos (not /precos)' },
      { path: '/precosx', label: '/precosx (not /precos)' },
      {
        path: '/politica-de-privacidade-antiga',
        label: '/politica-de-privacidade-antiga (not the legal page)',
      },
      { path: '/termos-de-uso-v2', label: '/termos-de-uso-v2 (not /termos-de-uso)' },
    ])('$label remains public (anonymous passes through)', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });

    it('near-miss /precos-internos passes for active user without redirect to /dashboard', async () => {
      // Defense-in-depth: even an active user hitting a near-miss path must
      // resolve to the public class (pass), never the gated `'app'` class.
      asActive();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/precos-internos'));
      expectPass(response);
    });
  });
});
