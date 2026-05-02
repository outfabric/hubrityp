import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `signOut` clears the Supabase session and redirects to `/login`. We mock
// the @supabase/ssr boundary so we can assert (a) `auth.signOut()` is invoked
// exactly once, and (b) the action throws a NEXT_REDIRECT pointing at /login
// EVEN when the underlying signOut call errors. The cookie clear itself is
// performed inside `@supabase/ssr` via the `setAll` callback we wired up in
// `lib/supabase/server.ts`; covering the library's internals would re-test
// upstream code and is not the goal here.

const signOutMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signOut: signOutMock,
    },
  }),
}));

beforeEach(() => {
  signOutMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

function extractRedirectTarget(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new Error(`expected Error with NEXT_REDIRECT digest, got ${typeof error}`);
  }
  const digest = (error as Error & { digest?: string }).digest;
  if (!digest || !digest.startsWith('NEXT_REDIRECT')) {
    throw new Error(`expected NEXT_REDIRECT digest, got: ${String(digest)}`);
  }
  const parts = digest.split(';');
  const target = parts[2];
  if (!target) throw new Error(`could not parse target from digest: ${digest}`);
  return target;
}

describe('signOut Server Action (integration)', () => {
  it('calls supabase.auth.signOut and redirects to /login on success', async () => {
    signOutMock.mockResolvedValue({ error: null });

    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('redirects to /login even when supabase.auth.signOut returns an error', async () => {
    // Supabase returning `{ error }` is non-fatal: the user's view of "I am
    // signed out" must still hold, so we redirect regardless. The error is
    // logged for debugging but does not change the navigation.
    signOutMock.mockResolvedValue({
      error: { name: 'AuthApiError', message: 'session not found' },
    });

    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('redirects to /login even when supabase.auth.signOut throws', async () => {
    // Network failure or any unexpected throw inside the helper must NOT
    // prevent navigation. The user clicked "Sair" and expects to land on
    // the login page; staying on /dashboard with a stale (or missing)
    // session would be confusing.
    signOutMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(extractRedirectTarget(caught)).toBe('/login');
  });
});
