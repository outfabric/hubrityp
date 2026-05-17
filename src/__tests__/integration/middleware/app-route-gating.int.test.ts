import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware correctly gates the
// authenticated app routes (/pacientes, /agenda, /caixa-de-entrada,
// /configuracoes) using the same strict prefix+separator pattern as
// /dashboard. Tests both the negative case (anonymous -> redirect to login)
// and the positive case (active user -> pass through).
//
// Also covers boundary cases: paths that START with a gated prefix but
// are NOT followed by `/` or end-of-string must remain public (e.g.,
// `/dashboardnews`, `/pacientes-info`).

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

describe('middleware app route gating (extended prefixes)', () => {
  // =====================================================================
  // Unauthenticated requests to gated app routes redirect to /login
  // =====================================================================
  describe('anonymous -> redirect to /login', () => {
    it.each([
      { path: '/pacientes', label: '/pacientes' },
      { path: '/pacientes/abc-123/prontuario', label: '/pacientes/abc-123/prontuario' },
      { path: '/agenda', label: '/agenda' },
      { path: '/caixa-de-entrada', label: '/caixa-de-entrada' },
      { path: '/configuracoes', label: '/configuracoes' },
      { path: '/configuracoes/perfil', label: '/configuracoes/perfil' },
    ])('$label redirects to /login with correct redirectTo', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe(path);
    });

    it('/dashboard still redirects to /login (unchanged behavior)', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    });

    it('/dashboard/settings/profile still redirects with full path in redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest('/dashboard/settings/profile'));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/dashboard/settings/profile');
    });
  });

  // =====================================================================
  // Active authenticated user passes through to gated routes
  // =====================================================================
  describe('active user -> pass through', () => {
    it.each([
      { path: '/pacientes', label: '/pacientes' },
      { path: '/pacientes/abc-123/prontuario', label: '/pacientes/abc-123/prontuario' },
      { path: '/agenda', label: '/agenda' },
      { path: '/caixa-de-entrada', label: '/caixa-de-entrada' },
      { path: '/configuracoes', label: '/configuracoes' },
      { path: '/dashboard', label: '/dashboard' },
    ])('$label passes through for active user', async ({ path }) => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Boundary: paths that look like gated prefixes but are NOT
  // (strict prefix + separator check prevents false matches)
  // =====================================================================
  describe('boundary: strict prefix prevents false matches', () => {
    it.each([
      { path: '/dashboardnews', label: '/dashboardnews (not /dashboard)' },
      { path: '/pacientes-info', label: '/pacientes-info (not /pacientes)' },
      { path: '/agenda-publica', label: '/agenda-publica (not /agenda)' },
      {
        path: '/caixa-de-entrada-externa',
        label: '/caixa-de-entrada-externa (not /caixa-de-entrada)',
      },
      { path: '/configuracoes-publicas', label: '/configuracoes-publicas (not /configuracoes)' },
    ])('$label remains public (anonymous passes through)', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });
});
