import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';

// Integration coverage for the per-user 60s throttle introduced by the QA-1
// fix for `resendVerificationEmailImpl`. Tests assert:
//
//   • A first call against a fresh `pending_verification` profile contacts
//     Supabase and stamps `profiles.last_resend_at`.
//   • A second call within the 60s window is rejected with `rate_limited`
//     WITHOUT touching Supabase — the gate is purely DB-driven.
//   • A second call after the throttle window is allowed again.
//   • Anonymous and non-pending callers still resolve to `invalid_status`.
//
// We mock `@/shared/supabase/server` to capture how often `auth.resend` is
// invoked. The DB itself (testcontainer) is real so the throttle column
// behaves as it would in production.

const { resendMock, getUserMock } = vi.hoisted(() => ({
  resendMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock('@/shared/supabase/server', () => ({
  // The Server Action only consumes `auth.resend` and the `auth.getUser`
  // path that `getCurrentProfile` uses. Everything else is unused.
  // The factory returns a Promise to mirror the production async builder
  // even though the body is synchronous.
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: getUserMock,
        resend: resendMock,
      },
    }),
  ),
}));

async function seedPendingProfile(): Promise<{ userId: string; email: string }> {
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

beforeEach(() => {
  resendMock.mockReset();
  resendMock.mockResolvedValue({ error: null });
  getUserMock.mockReset();
});

afterEach(async () => {
  vi.resetModules();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('resendVerificationEmailImpl (integration, real DB)', () => {
  it('returns ok and stamps last_resend_at on the first call', async () => {
    const seeded = await seedPendingProfile();
    getUserMock.mockResolvedValue({ data: { user: { id: seeded.userId } }, error: null });

    const { resendVerificationEmailImpl } =
      await import('@/modules/registration/server/resend-verification');
    const result = await resendVerificationEmailImpl();

    expect(result).toEqual({ ok: true });
    expect(resendMock).toHaveBeenCalledTimes(1);

    const [row] = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, seeded.userId)),
    );
    expect(row?.lastResendAt).toBeInstanceOf(Date);
    expect(row!.lastResendAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('rejects a second call within the 60s window without contacting Supabase', async () => {
    const seeded = await seedPendingProfile();
    getUserMock.mockResolvedValue({ data: { user: { id: seeded.userId } }, error: null });

    // Simulate a previous resend 5 seconds ago.
    await runAsService(async (db) => {
      const fiveSecondsAgo = new Date(Date.now() - 5_000);
      await db
        .update(profiles)
        .set({ lastResendAt: fiveSecondsAgo })
        .where(eq(profiles.userId, seeded.userId));
    });

    const { resendVerificationEmailImpl } =
      await import('@/modules/registration/server/resend-verification');
    const result = await resendVerificationEmailImpl();

    expect(result).toEqual({ ok: false, error: 'rate_limited' });
    // The throttle gate runs BEFORE we call Supabase, so the SDK is never
    // invoked. This is the QA-1 finding #4 contract.
    expect(resendMock).not.toHaveBeenCalled();
  });

  it('allows a resend after the throttle window has elapsed', async () => {
    const seeded = await seedPendingProfile();
    getUserMock.mockResolvedValue({ data: { user: { id: seeded.userId } }, error: null });

    // Stamp the resend a tick over 60s ago.
    await runAsService(async (db) => {
      const oldEnough = new Date(Date.now() - 61_000);
      await db
        .update(profiles)
        .set({ lastResendAt: oldEnough })
        .where(eq(profiles.userId, seeded.userId));
    });

    const { resendVerificationEmailImpl } =
      await import('@/modules/registration/server/resend-verification');
    const result = await resendVerificationEmailImpl();

    expect(result).toEqual({ ok: true });
    expect(resendMock).toHaveBeenCalledTimes(1);
  });

  it('returns invalid_status for an anonymous caller and never queries Supabase', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const { resendVerificationEmailImpl } =
      await import('@/modules/registration/server/resend-verification');
    const result = await resendVerificationEmailImpl();

    expect(result).toEqual({ ok: false, error: 'invalid_status' });
    expect(resendMock).not.toHaveBeenCalled();
  });
});
