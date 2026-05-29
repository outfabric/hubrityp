import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware gates the AI transcription
// review UI (`/dashboard/transcricoes*`). This route is NEW within the (app)
// route group; its URL lives under `/dashboard`, which the classifier already
// resolves to the `'app'` (gated) class via the strict prefix+separator check.
//
// Coverage (per specs/middleware-gating/spec.md):
//   - Anonymous -> 307 to /login?redirectTo=<path> for the list page
//     (/dashboard/transcricoes) AND the review subpath
//     (/dashboard/transcricoes/abc-123/revisar). (negative-auth)
//   - Active user -> pass through both paths. (positive-auth)
//   - Suspended user -> cleared-and-redirected to /login per the existing
//     decision table (signOut + cookie clear).

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

function profileWithStatus(status: ProfileStatus) {
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function asActiveUser() {
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
  getCurrentProfileEdgeMock.mockResolvedValue(profileWithStatus(ProfileStatus.Active));
}

function asSuspendedUser() {
  // When the profile resolves, the middleware does NOT call getUser() again,
  // so only the profile mock matters for the decision. signOut is exercised.
  getCurrentProfileEdgeMock.mockResolvedValue(profileWithStatus(ProfileStatus.Suspended));
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

// -- Tests --------------------------------------------------------------------

const LIST_PATH = '/dashboard/transcricoes';
const REVIEW_PATH = '/dashboard/transcricoes/abc-123/revisar';

describe('middleware /dashboard/transcricoes route gating (AI transcription review)', () => {
  // =====================================================================
  // Negative-auth: anonymous requests redirect to /login
  // =====================================================================
  describe('anonymous -> redirect to /login', () => {
    it.each([
      { path: LIST_PATH, label: 'list page' },
      { path: REVIEW_PATH, label: 'review subpath' },
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
  // Positive-auth: active user passes through
  // =====================================================================
  describe('active user -> pass through', () => {
    it.each([
      { path: LIST_PATH, label: 'list page' },
      { path: REVIEW_PATH, label: 'review subpath' },
    ])('$label passes through for active user', async ({ path }) => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Suspended user -> cleared-and-redirected per the existing decision table
  // =====================================================================
  describe('suspended user -> clear-and-redirect to /login', () => {
    it.each([
      { path: LIST_PATH, label: 'list page' },
      { path: REVIEW_PATH, label: 'review subpath' },
    ])('$label clears the session and redirects to /login', async ({ path }) => {
      asSuspendedUser();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      // signOut MUST be called so the suspended session cookie is invalidated
      // server-side before the redirect (otherwise the next request loops).
      expect(signOutMock).toHaveBeenCalledTimes(1);

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      // Suspended redirect goes straight to /login without a redirectTo (the
      // user must re-authenticate before any gated destination is honored).
      expect(url.searchParams.get('redirectTo')).toBeNull();
    });
  });
});
