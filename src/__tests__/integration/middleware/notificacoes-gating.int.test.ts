import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies the middleware gates the notification-preferences
// page (`/configuracoes/notificacoes`). This route is NEW within the (app)
// route group; its URL lives under `/configuracoes`, which the classifier
// already resolves to the `'app'` (gated) class via the strict prefix+separator
// check. This proves the existing `/configuracoes` classification covers the
// new route WITHOUT needing a dedicated classifier entry.
//
// Coverage (per specs/middleware-gating/spec.md + in-app-notifications/spec.md):
//   - Anonymous -> 307 to /login?redirectTo=/configuracoes/notificacoes.
//     (negative-auth — the key proof for this section)
//   - Active user -> pass through. (positive-auth)
//   - Suspended user -> cleared-and-redirected to /login (signOut + cookie
//     clear) per the existing decision table.

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

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000002';

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

const NOTIFICACOES_PATH = '/configuracoes/notificacoes';

describe('middleware /configuracoes/notificacoes route gating (notification preferences)', () => {
  // =====================================================================
  // Negative-auth: anonymous requests redirect to /login
  // =====================================================================
  describe('anonymous -> redirect to /login', () => {
    it('redirects to /login with redirectTo=/configuracoes/notificacoes', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(NOTIFICACOES_PATH));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe(NOTIFICACOES_PATH);
    });
  });

  // =====================================================================
  // Positive-auth: active user passes through
  // =====================================================================
  describe('active user -> pass through', () => {
    it('passes through for an active user', async () => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(NOTIFICACOES_PATH)));
    });
  });

  // =====================================================================
  // Suspended user -> cleared-and-redirected per the existing decision table
  // =====================================================================
  describe('suspended user -> clear-and-redirect to /login', () => {
    it('clears the session and redirects to /login', async () => {
      asSuspendedUser();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(NOTIFICACOES_PATH));

      expect(signOutMock).toHaveBeenCalledTimes(1);

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBeNull();
    });
  });
});
