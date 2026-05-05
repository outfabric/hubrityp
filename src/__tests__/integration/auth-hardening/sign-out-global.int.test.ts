import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { authSessions } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 6.8 — Global sign-out integration test
//
// Verifies that `signOutImpl`:
// 1. Calls `supabase.auth.signOut({ scope: 'global' })`
// 2. Revokes all `auth_sessions` rows for the user (`revokedAt` populated)
// 3. Clears the `hp_keep_logged_in` cookie
// 4. Redirects to `/login`
// ---------------------------------------------------------------------------

const SEED_USER_ID = randomUUID();
const signOutMock = vi.fn();
const getUserMock = vi.fn();
const cookieSetMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signOut: signOutMock,
      getUser: getUserMock,
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: cookieSetMock,
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock logAuthEvent to avoid hitting the real headers() in log-auth-event
vi.mock('@/modules/registration/server/log-auth-event', () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

function extractRedirectTarget(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new Error(`expected Error with NEXT_REDIRECT digest, got ${typeof error}`);
  }
  const digest = (error as Error & { digest?: string }).digest;
  if (!digest || !digest.startsWith('NEXT_REDIRECT')) {
    throw new Error(`expected NEXT_REDIRECT digest, got: ${String(digest)}`);
  }
  const target = digest.split(';')[2];
  if (!target) throw new Error(`could not parse target from digest: ${digest}`);
  return target;
}

// Seed the auth.users row so the FK from auth_sessions is satisfied.
beforeAll(async () => {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${SEED_USER_ID}, 'signout-test@test.local', '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
});

beforeEach(() => {
  signOutMock.mockReset();
  getUserMock.mockReset();
  cookieSetMock.mockReset();

  getUserMock.mockResolvedValue({
    data: { user: { id: SEED_USER_ID, email: 'signout-test@test.local' } },
    error: null,
  });
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(async () => {
  vi.resetModules();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_sessions`);
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM profiles WHERE user_id = ${SEED_USER_ID}`);
  });
});

describe('signOut global (integration)', () => {
  it('calls supabase.auth.signOut with scope: global', async () => {
    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'global' });
    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('populates revokedAt on auth_sessions rows after signOut', async () => {
    // Seed two auth_sessions rows for the user
    await runAsService(async (db) => {
      await db.insert(authSessions).values([
        {
          userId: SEED_USER_ID,
          ip: '127.0.0.1',
          userAgent: 'Test Browser 1',
          expiresAt: new Date(Date.now() + 86400_000),
        },
        {
          userId: SEED_USER_ID,
          ip: '192.168.1.1',
          userAgent: 'Test Browser 2',
          expiresAt: new Date(Date.now() + 86400_000),
        },
      ]);
    });

    // Verify sessions exist and revokedAt is null
    const beforeSessions = await runAsService(async (db) => {
      return db
        .select({ revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.userId, SEED_USER_ID));
    });
    expect(beforeSessions).toHaveLength(2);
    expect(beforeSessions.every((s) => s.revokedAt === null)).toBe(true);

    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login');

    // Verify revokedAt is now populated for all sessions
    const afterSessions = await runAsService(async (db) => {
      return db
        .select({ revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.userId, SEED_USER_ID));
    });
    expect(afterSessions).toHaveLength(2);
    expect(afterSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('clears the hp_keep_logged_in cookie', async () => {
    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login');

    // Verify cookie was cleared (set with maxAge: 0)
    expect(cookieSetMock).toHaveBeenCalledWith(
      'hp_keep_logged_in',
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it('still redirects to /login even when supabase.auth.signOut fails', async () => {
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

    expect(extractRedirectTarget(caught)).toBe('/login');
  });

  it('still redirects to /login even when supabase.auth.signOut throws', async () => {
    signOutMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    const { signOut } = await import('@/app/(app)/actions');

    let caught: unknown = null;
    try {
      await signOut();
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/login');
  });
});
