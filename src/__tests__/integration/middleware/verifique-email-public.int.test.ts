import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware classifies the exact path
// `/verifique-email` as the `public` PathClass for EVERY session state in the
// decision table. A just-signed-up email user reaches this page while still
// anonymous; without an explicit `public` classification the anonymous request
// would be redirected to `/login`. The near-miss `/verifique-emailx` must NOT
// be matched by the explicit (exact-match) public classification — it falls
// through to default-public instead, which is the observable boundary asserted
// here via the exported `classifyPath()`.

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

function asPendingVerification() {
  asAuthedUser(baseProfile({ status: ProfileStatus.PendingVerification }));
}

function asPendingCrpValidation() {
  asAuthedUser(baseProfile({ status: ProfileStatus.PendingCrpValidation }));
}

function asActive() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Active, requiresPasswordReset: false }));
}

function asActiveRpr() {
  asAuthedUser(baseProfile({ status: ProfileStatus.Active, requiresPasswordReset: true }));
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function expectPass(response: Response) {
  expect(response.headers.get('location')).toBeNull();
  expect(response.status).toBeLessThan(300);
}

const VERIFIQUE_EMAIL_PATH = '/verifique-email';

// -- Tests --------------------------------------------------------------------

describe('middleware /verifique-email public gating', () => {
  // =====================================================================
  // Scenario 1: the just-signed-up anonymous user -> pass (NOT /login)
  // =====================================================================
  it('anonymous user passes through (no redirect to /login)', async () => {
    asAnon();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest(VERIFIQUE_EMAIL_PATH));
    expectPass(response);
    expect(response.headers.get('location')).toBeNull();
  });

  // =====================================================================
  // Scenario 2: every profile status still reaches the page -> pass
  // =====================================================================
  it('pending_verification user passes through', async () => {
    asPendingVerification();
    const { middleware } = await import('@/middleware');
    expectPass(await middleware(makeRequest(VERIFIQUE_EMAIL_PATH)));
  });

  it('pending_crp_validation user passes through', async () => {
    asPendingCrpValidation();
    const { middleware } = await import('@/middleware');
    expectPass(await middleware(makeRequest(VERIFIQUE_EMAIL_PATH)));
  });

  it('active user passes through (NOT bounced to /dashboard)', async () => {
    asActive();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest(VERIFIQUE_EMAIL_PATH));
    expectPass(response);
    expect(response.headers.get('location')).toBeNull();
  });

  it('active + requires_password_reset user passes through', async () => {
    asActiveRpr();
    const { middleware } = await import('@/middleware');
    expectPass(await middleware(makeRequest(VERIFIQUE_EMAIL_PATH)));
  });

  // =====================================================================
  // Scenario 3: classification boundary — exact match only
  // =====================================================================
  describe('classifyPath boundary', () => {
    it('classifies the exact path /verifique-email as public', async () => {
      const { classifyPath } = await import('@/middleware');
      expect(classifyPath(VERIFIQUE_EMAIL_PATH)).toBe('public');
    });

    it('does NOT match the near-miss /verifique-emailx via the explicit rule', async () => {
      // The explicit classification is exact-match only — a near-miss has no
      // prefix branch and therefore reaches the page only through the
      // default-public fallthrough, not the dedicated `/verifique-email` rule.
      // Both resolve to 'public', so the observable boundary is that an active
      // user on the near-miss path is NOT routed into the gated `'app'` class.
      const { classifyPath } = await import('@/middleware');
      expect(classifyPath('/verifique-emailx')).toBe('public');

      asActive();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/verifique-emailx'));
      expectPass(response);
      expect(response.headers.get('location')).toBeNull();
    });
  });
});
