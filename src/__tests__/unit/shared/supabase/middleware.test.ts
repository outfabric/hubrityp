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
      delete: vi.fn(),
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

// `findSupabaseAuthCookieNames` is a pure filter over `request.cookies` —
// the unit test pins the regex shape so a future rename or added cookie
// family can't silently break the suspended/cancelled cookie clear.
describe('shared/supabase/middleware.findSupabaseAuthCookieNames', () => {
  function buildRequest(cookies: { name: string; value: string }[]): NextRequest {
    return {
      cookies: {
        getAll: () => cookies,
      },
    } as unknown as NextRequest;
  }

  it('matches the single-cookie session shape (sb-<ref>-auth-token)', async () => {
    const { findSupabaseAuthCookieNames } = await import('@/shared/supabase/middleware');
    const result = findSupabaseAuthCookieNames(
      buildRequest([{ name: 'sb-localhost-auth-token', value: 'jwt' }]),
    );
    expect(result).toEqual(['sb-localhost-auth-token']);
  });

  it('matches the chunked session shape (sb-<ref>-auth-token.0, .1, ...)', async () => {
    const { findSupabaseAuthCookieNames } = await import('@/shared/supabase/middleware');
    const result = findSupabaseAuthCookieNames(
      buildRequest([
        { name: 'sb-abc-auth-token.0', value: 'a' },
        { name: 'sb-abc-auth-token.1', value: 'b' },
        { name: 'sb-abc-auth-token.2', value: 'c' },
      ]),
    );
    expect(result).toEqual(['sb-abc-auth-token.0', 'sb-abc-auth-token.1', 'sb-abc-auth-token.2']);
  });

  it('does not match unrelated Supabase cookies (e.g. realtime, csrf)', async () => {
    const { findSupabaseAuthCookieNames } = await import('@/shared/supabase/middleware');
    const result = findSupabaseAuthCookieNames(
      buildRequest([
        { name: 'sb-csrf-token', value: 'csrf' },
        { name: 'sb-realtime', value: 'rt' },
        { name: 'theme', value: 'dark' },
      ]),
    );
    expect(result).toEqual([]);
  });

  it('mixes single + chunked + unrelated correctly', async () => {
    const { findSupabaseAuthCookieNames } = await import('@/shared/supabase/middleware');
    const result = findSupabaseAuthCookieNames(
      buildRequest([
        { name: 'sb-x-auth-token', value: 'a' },
        { name: 'sb-x-auth-token.0', value: 'a0' },
        { name: 'sb-x-auth-token.1', value: 'a1' },
        { name: 'sb-other-auth-token', value: 'other' },
        { name: 'theme', value: 'dark' },
      ]),
    );
    expect(result).toEqual([
      'sb-x-auth-token',
      'sb-x-auth-token.0',
      'sb-x-auth-token.1',
      'sb-other-auth-token',
    ]);
  });

  it('returns an empty array when no cookies are present', async () => {
    const { findSupabaseAuthCookieNames } = await import('@/shared/supabase/middleware');
    expect(findSupabaseAuthCookieNames(buildRequest([]))).toEqual([]);
  });
});

describe('shared/supabase/middleware.clearSupabaseAuthCookies', () => {
  it('calls response.cookies.delete for each matched cookie name', async () => {
    const { clearSupabaseAuthCookies } = await import('@/shared/supabase/middleware');

    const request = {
      cookies: {
        getAll: () => [
          { name: 'sb-test-auth-token.0', value: 'a' },
          { name: 'sb-test-auth-token.1', value: 'b' },
          { name: 'theme', value: 'dark' },
        ],
      },
    } as unknown as NextRequest;

    const deleteMock = vi.fn();
    const response = { cookies: { delete: deleteMock } } as unknown as Parameters<
      typeof clearSupabaseAuthCookies
    >[1];

    clearSupabaseAuthCookies(request, response);

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenNthCalledWith(1, 'sb-test-auth-token.0');
    expect(deleteMock).toHaveBeenNthCalledWith(2, 'sb-test-auth-token.1');
  });
});
