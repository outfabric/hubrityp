import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware correctly gates the
// `/sessao` route prefix (telepsychology video sessions). Anonymous users
// are redirected to /login (negative-auth); active psychologists pass
// through (positive-auth). Also covers the strict prefix+separator
// boundary to prevent false matches like `/sessao-publica`.

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
  getCurrentProfileEdgeMock.mockResolvedValue({
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
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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

describe('middleware /sessao route gating (telepsychology)', () => {
  // =====================================================================
  // Unauthenticated requests to /sessao/* redirect to /login
  // =====================================================================
  describe('anonymous -> redirect to /login', () => {
    it.each([
      { path: '/sessao', label: '/sessao' },
      { path: '/sessao/fake-uuid/video', label: '/sessao/fake-uuid/video' },
      {
        path: '/sessao/00000000-0000-4000-8000-000000000099/video',
        label: '/sessao/<uuid>/video',
      },
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
  // Active authenticated user passes through to /sessao/*
  // =====================================================================
  describe('active user -> pass through', () => {
    it.each([
      { path: '/sessao', label: '/sessao' },
      { path: '/sessao/fake-uuid/video', label: '/sessao/fake-uuid/video' },
    ])('$label passes through for active user', async ({ path }) => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Boundary: paths that look like /sessao but are NOT
  // (strict prefix + separator check prevents false matches)
  // =====================================================================
  describe('boundary: strict prefix prevents false matches', () => {
    it.each([
      { path: '/sessao-publica', label: '/sessao-publica (not /sessao)' },
      { path: '/sessaonova', label: '/sessaonova (not /sessao)' },
    ])('$label remains public (anonymous passes through)', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });
});
