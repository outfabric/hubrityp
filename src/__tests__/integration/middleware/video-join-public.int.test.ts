import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the middleware classifies /v (patient
// video join) as public. The token in the URL is the authorization
// credential -- there is no Supabase session. Anonymous access must pass
// through (no redirect to /login).

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

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function expectPass(response: Response) {
  expect(response.headers.get('location')).toBeNull();
  expect(response.status).toBeLessThan(300);
}

// -- Tests --------------------------------------------------------------------

describe('middleware /v route — public patient video join', () => {
  // =====================================================================
  // Unauthenticated requests to /v/* pass through (public, token-gated)
  // =====================================================================
  describe('anonymous -> pass through (no redirect)', () => {
    it.each([
      { path: '/v/some-token', label: '/v/some-token' },
      { path: '/v/00000000-0000-4000-8000-000000000099', label: '/v/<uuid>' },
      { path: '/v', label: '/v (bare)' },
    ])('$label passes through for anonymous user', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });

  // =====================================================================
  // Boundary: paths that look like /v but are NOT — strict prefix check
  // These should still be public (they fall through to default-public)
  // but this test documents the boundary behavior.
  // =====================================================================
  describe('boundary: /v prefix is strictly matched', () => {
    it.each([
      { path: '/video', label: '/video (not /v)' },
      { path: '/verificar', label: '/verificar (not /v)' },
    ])('$label remains public (anonymous passes through)', async ({ path }) => {
      asAnon();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });
});
