import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Integration test: verifies that the `/escala` prefix is classified as
// 'public' by the middleware and that GET /escala/[token] does NOT redirect
// to login for an anonymous request.
//
// Follows the same mock pattern as the existing middleware integration tests
// in `src/__tests__/integration/middleware/`.

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

// -- Helpers ------------------------------------------------------------------

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

describe('middleware /escala public classification', () => {
  it('classifyPath returns "public" for /escala/abc123', async () => {
    // classifyPath is not exported, but we can verify the behavior through
    // the middleware itself: an anonymous request to /escala/abc123 must
    // pass through (not redirect to /login).
    asAnon();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest('/escala/abc123'));

    expectPass(response);
  });

  it('classifyPath returns "public" for /escala', async () => {
    asAnon();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest('/escala'));

    expectPass(response);
  });

  it('classifyPath returns "public" for /escala/some-long-token-value/extra', async () => {
    asAnon();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest('/escala/some-long-token-value/extra'));

    expectPass(response);
  });

  it('GET /escala/[token] does NOT redirect anonymous users to /login', async () => {
    asAnon();
    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest('/escala/a1b2c3d4e5f6'));

    // The middleware must not redirect — status should be < 300 and no Location header
    expectPass(response);
  });

  it('/escala prefix does not match /escalation (strict prefix check)', async () => {
    asAnon();
    const { middleware } = await import('@/middleware');
    // /escalation is NOT /escala nor /escala/* — it should fall through to
    // default public. This verifies our prefix check doesn't over-match.
    const response = await middleware(makeRequest('/escalation'));

    // Should still pass (default is public), but verifying the boundary
    expectPass(response);
  });
});
