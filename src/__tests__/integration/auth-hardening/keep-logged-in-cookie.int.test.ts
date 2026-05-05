import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearKeepLoggedInCookie,
  KEEP_LOGGED_IN_COOKIE_NAME,
  KEEP_LOGGED_IN_MAX_AGE,
  setKeepLoggedInCookie,
} from '@/shared/lib/cookies/keep-logged-in';

// ---------------------------------------------------------------------------
// Mock infrastructure
//
// We mock `next/headers` to supply a controlled cookie store, and
// `@supabase/ssr` to capture the cookie callbacks that our wrapper passes in.
// This lets us exercise the Max-Age logic in `createServerClient` without
// needing a live GoTrue or a real HTTP request.
// ---------------------------------------------------------------------------

const cookieSetSpy = vi.fn();
const cookieGetSpy = vi.fn();
const cookieGetAllSpy = vi.fn();

const createSsrServerClientMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: createSsrServerClientMock,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: cookieGetSpy,
    getAll: cookieGetAllSpy,
    set: cookieSetSpy,
  }),
}));

beforeEach(() => {
  createSsrServerClientMock.mockReset();
  cookieSetSpy.mockReset();
  cookieGetSpy.mockReset();
  cookieGetAllSpy.mockReset();

  // Default: no keep-logged-in cookie present
  cookieGetSpy.mockReturnValue(undefined);
  cookieGetAllSpy.mockReturnValue([]);
  createSsrServerClientMock.mockReturnValue({ marker: 'server-client' });
});

afterEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helper: invoke the `setAll` callback that our wrapper passes to @supabase/ssr
// ---------------------------------------------------------------------------

type CookieEntry = { name: string; value: string; options: Record<string, unknown> };

async function getSetAllCallback(): Promise<(cookies: CookieEntry[]) => void> {
  const { createServerClient } = await import('@/shared/supabase/server');
  await createServerClient();

  expect(createSsrServerClientMock).toHaveBeenCalledTimes(1);

  const call = createSsrServerClientMock.mock.calls[0] as [
    string,
    string,
    { cookies: { setAll: (cookies: CookieEntry[]) => void } },
  ];
  return call[2].cookies.setAll;
}

// ---------------------------------------------------------------------------
// Tests: Supabase session cookie Max-Age controlled by sidecar
// ---------------------------------------------------------------------------

describe('keep-logged-in cookie sidecar → Supabase session Max-Age', () => {
  describe('when hp_keep_logged_in=1 is present (persistent session)', () => {
    beforeEach(() => {
      cookieGetSpy.mockImplementation((name: string) => {
        if (name === KEEP_LOGGED_IN_COOKIE_NAME) return { name, value: '1' };
        return undefined;
      });
    });

    it('applies Max-Age=86400 to Supabase session cookies', async () => {
      const setAll = await getSetAllCallback();

      const fakeCookies: CookieEntry[] = [
        {
          name: 'sb-abc-auth-token',
          value: 'access-token-value',
          options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax' },
        },
        {
          name: 'sb-abc-refresh-token',
          value: 'refresh-token-value',
          options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax' },
        },
      ];

      setAll(fakeCookies);

      // Each cookie was written with Max-Age = 86400
      expect(cookieSetSpy).toHaveBeenCalledTimes(2);

      const firstCall = cookieSetSpy.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(firstCall[0]).toBe('sb-abc-auth-token');
      expect(firstCall[2]).toMatchObject({ maxAge: KEEP_LOGGED_IN_MAX_AGE });

      const secondCall = cookieSetSpy.mock.calls[1] as [string, string, Record<string, unknown>];
      expect(secondCall[0]).toBe('sb-abc-refresh-token');
      expect(secondCall[2]).toMatchObject({ maxAge: KEEP_LOGGED_IN_MAX_AGE });
    });

    it('overrides any pre-existing maxAge from @supabase/ssr options', async () => {
      const setAll = await getSetAllCallback();

      setAll([
        {
          name: 'sb-abc-auth-token',
          value: 'v',
          options: { path: '/', maxAge: 999_999 },
        },
      ]);

      const call = cookieSetSpy.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(call[2]).toMatchObject({ maxAge: KEEP_LOGGED_IN_MAX_AGE });
    });
  });

  describe('when hp_keep_logged_in is absent or not "1" (session cookie)', () => {
    it('produces session cookies (no Max-Age) when sidecar is absent', async () => {
      cookieGetSpy.mockReturnValue(undefined);

      const setAll = await getSetAllCallback();

      setAll([
        {
          name: 'sb-abc-auth-token',
          value: 'access-token-value',
          options: { path: '/', httpOnly: true, maxAge: 604_800 },
        },
      ]);

      const call = cookieSetSpy.mock.calls[0] as [string, string, Record<string, unknown>];
      // maxAge must be stripped (undefined) for session-only behaviour
      expect(call[2].maxAge).toBeUndefined();
    });

    it('produces session cookies when sidecar value is "0"', async () => {
      cookieGetSpy.mockImplementation((name: string) => {
        if (name === KEEP_LOGGED_IN_COOKIE_NAME) return { name, value: '0' };
        return undefined;
      });

      const setAll = await getSetAllCallback();

      setAll([
        {
          name: 'sb-abc-auth-token',
          value: 'v',
          options: { path: '/', maxAge: 604_800 },
        },
      ]);

      const call = cookieSetSpy.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(call[2].maxAge).toBeUndefined();
    });

    it('produces session cookies when sidecar has unexpected value', async () => {
      cookieGetSpy.mockImplementation((name: string) => {
        if (name === KEEP_LOGGED_IN_COOKIE_NAME) return { name, value: 'maybe' };
        return undefined;
      });

      const setAll = await getSetAllCallback();

      setAll([
        {
          name: 'sb-abc-auth-token',
          value: 'v',
          options: { path: '/', maxAge: 604_800 },
        },
      ]);

      const call = cookieSetSpy.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(call[2].maxAge).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: setKeepLoggedInCookie / clearKeepLoggedInCookie helpers
// ---------------------------------------------------------------------------

describe('setKeepLoggedInCookie helper', () => {
  it('writes hp_keep_logged_in=1 with Max-Age=86400 when keepLoggedIn=true', () => {
    const mockStore = { set: vi.fn() };

    setKeepLoggedInCookie(mockStore, true);

    expect(mockStore.set).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenCalledWith(KEEP_LOGGED_IN_COOKIE_NAME, '1', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: KEEP_LOGGED_IN_MAX_AGE,
    });
  });

  it('writes hp_keep_logged_in=0 without Max-Age when keepLoggedIn=false', () => {
    const mockStore = { set: vi.fn() };

    setKeepLoggedInCookie(mockStore, false);

    expect(mockStore.set).toHaveBeenCalledTimes(1);
    const call = mockStore.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(call[0]).toBe(KEEP_LOGGED_IN_COOKIE_NAME);
    expect(call[1]).toBe('0');
    // Session cookie: no maxAge property
    expect(call[2]).not.toHaveProperty('maxAge');
  });
});

describe('clearKeepLoggedInCookie helper', () => {
  it('sets Max-Age=0 to expire the cookie immediately', () => {
    const mockStore = { set: vi.fn() };

    clearKeepLoggedInCookie(mockStore);

    expect(mockStore.set).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenCalledWith(KEEP_LOGGED_IN_COOKIE_NAME, '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 0,
    });
  });
});
