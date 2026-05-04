import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';
import { markCrpValidated } from './helpers/markCrpValidated';

// Real-DB integration coverage of `signInImpl`'s status-aware branch
// against the registration-domain profile lifecycle.
//
// Unlike `auth-signin.int.test.ts` (section 7), this test does NOT mock
// `getCurrentProfile`. It only mocks the `@supabase/ssr`
// `signInWithPassword`/`signOut` surface (so we don't need GoTrue) and
// lets the REAL Drizzle `getCurrentProfile` adapter run against rows
// that the section-2 trigger materialized — exercising the contract
// from the registration spec (pending → /onboarding/pending; suspended
// → account_unavailable + cookies cleared).
//
// We focus exclusively on the registration-driven status branches
// (the ones the registration spec adds): pending_verification,
// pending_crp_validation, active, suspended, cancelled. Auth-only
// scenarios (invalid credentials, malformed input, redirect-target
// validation, etc.) stay covered by section 7's test.

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();
const sessionRef: { current: { id: string; email: string } | null } = { current: null };

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
      // `getCurrentProfile` calls `auth.getUser()` to obtain the user
      // id, then issues a Drizzle SELECT — so we wire `getUser` to read
      // the staged session.
      // eslint-disable-next-line @typescript-eslint/require-await -- shaped to match the SupabaseClient surface, which returns a Promise even on synchronous resolution
      getUser: async () => ({
        data: { user: sessionRef.current ? { ...sessionRef.current } : null },
        error: sessionRef.current ? null : { message: 'no session' },
      }),
    },
  }),
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signOutMock.mockReset();
  // Default: signInWithPassword succeeds and the session is the
  // currently-staged one. Tests override `sessionRef.current` before
  // calling `signIn`.
  signInWithPasswordMock.mockImplementation(() => Promise.resolve({ data: {}, error: null }));
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(async () => {
  vi.resetModules();
  sessionRef.current = null;
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
    await db.execute(dsql`DELETE FROM auth_logs`);
  });
});

async function seedProfile(): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  const email = signupInputFactory.uniqueEmail();
  const meta = {
    fullName: 'Maria Silva',
    crpNumber: signupInputFactory.uniqueCrpNumber(),
    crpUf: 'SP',
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    sensitiveDataConsentAt: new Date().toISOString(),
  };
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
  });
  return { userId, email };
}

async function setStatus(userId: string, status: string): Promise<void> {
  await runAsService(async (db) => {
    await db.update(profiles).set({ status }).where(eq(profiles.userId, userId));
  });
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// `redirect()` from `next/navigation` throws an Error whose `digest`
// starts with `NEXT_REDIRECT;<kind>;<target>;<status>;...`.
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

describe('signIn status-aware (real DB profiles)', () => {
  it('pending_verification → redirects to /onboarding/pending', async () => {
    const seeded = await seedProfile();
    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    let caught: unknown = null;
    try {
      await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/onboarding/pending');
    // Pending users keep their session — signOut MUST NOT have run.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('pending_crp_validation → redirects to /onboarding/pending', async () => {
    const seeded = await seedProfile();
    // Drive the email-confirmed trigger so the row transitions to
    // pending_crp_validation. We're using the REAL trigger here.
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${seeded.userId}`,
      );
    });
    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    let caught: unknown = null;
    try {
      await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/onboarding/pending');
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('active → redirects to /dashboard', async () => {
    const seeded = await seedProfile();
    await markCrpValidated(seeded.userId);
    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    let caught: unknown = null;
    try {
      await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));
    } catch (err) {
      caught = err;
    }

    expect(extractRedirectTarget(caught)).toBe('/dashboard');
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('suspended → returns account_unavailable AND clears cookies via signOut', async () => {
    const seeded = await seedProfile();
    await setStatus(seeded.userId, 'suspended');
    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));

    expect(result).toEqual({ ok: false, error: 'account_unavailable' });
    // signOut is the cookie-clearing path. Its presence here is the
    // contract: the session that signInWithPassword just opened must
    // be revoked before the result returns to the UI.
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('cancelled → returns account_unavailable AND clears cookies via signOut', async () => {
    const seeded = await seedProfile();
    await setStatus(seeded.userId, 'cancelled');
    sessionRef.current = { id: seeded.userId, email: seeded.email };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(buildFormData({ email: seeded.email, password: 'correct-horse' }));

    expect(result).toEqual({ ok: false, error: 'account_unavailable' });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('authenticated session with no profile row → returns unknown AND signs out', async () => {
    // Stage a session whose `auth.uid()` does not match any
    // `profiles` row. This covers the race window between auth.signUp
    // returning and the trigger committing.
    sessionRef.current = { id: randomUUID(), email: 'orphan@test.local' };

    const { signIn } = await import('@/app/(auth)/login/actions');

    const result = await signIn(
      buildFormData({ email: 'orphan@test.local', password: 'correct-horse' }),
    );

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
