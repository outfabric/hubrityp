import { type NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSsrServerClientMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: createSsrServerClientMock,
}));

vi.mock('next/server', () => {
  class FakeNextResponse {
    cookies = {
      set: vi.fn(),
    };
    constructor(public init: unknown) {}
    static next(init?: unknown) {
      return new FakeNextResponse(init);
    }
  }
  return { NextResponse: FakeNextResponse };
});

beforeEach(() => {
  createSsrServerClientMock.mockReset();
  createSsrServerClientMock.mockReturnValue({ marker: 'mw-client' });
});

describe('shared/supabase/middleware.createMiddlewareClient', () => {
  it('passes the public env to @supabase/ssr and returns a response object', async () => {
    const { createMiddlewareClient } = await import('@/shared/supabase/middleware');
    const fakeRequest = {
      cookies: {
        getAll: () => [{ name: 'sb-token', value: 'v' }],
        set: vi.fn(),
      },
    } as unknown as NextRequest;

    const { supabase, response } = createMiddlewareClient(fakeRequest);

    expect(supabase).toEqual({ marker: 'mw-client' });
    expect(response).toBeDefined();

    const [url, anonKey] = createSsrServerClientMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:54321');
    expect(anonKey).toBe('unit-test-anon-key');
  });
});
