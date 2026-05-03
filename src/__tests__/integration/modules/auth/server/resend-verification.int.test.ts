import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Same mock harness as `signup.int.test.ts` — both Supabase boundaries
// (anon-key server client for `auth.getUser`, admin client for
// `auth.resend`) are mocked so each scenario stages exact responses.

const getUserMock = vi.fn();
const adminResendMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

vi.mock('@/shared/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      resend: adminResendMock,
    },
  })),
}));

const warnSpy = vi.fn();
const infoSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: vi.fn(),
    info: (...args: unknown[]): void => {
      infoSpy(...args);
    },
    debug: vi.fn(),
  },
  redactPaths: [],
}));

async function seedAuthUser(userId: string, email: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedProfile(userId: string, status: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(psychologistProfiles).values({
      userId,
      fullName: 'Test User',
      // Random CRP per call to dodge UNIQUE collisions across cases.
      crpNumber: `06/${String(Math.floor(100000 + Math.random() * 900000))}`,
      crpUf: 'SP',
      status,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
      termsVersion: '2026-05',
      privacyVersion: '2026-05',
      sensitiveDataConsentVersion: '2026-05',
    });
  });
}

beforeEach(() => {
  getUserMock.mockReset();
  adminResendMock.mockReset();
  warnSpy.mockReset();
  infoSpy.mockReset();
});

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(authResendLog);
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
  vi.resetModules();
});

describe('resendVerificationEmailImpl (integration)', () => {
  it('returns unauthenticated when no user is on the session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
    expect(adminResendMock).not.toHaveBeenCalled();
  });

  it('returns forbidden when the authenticated user has status active', async () => {
    const userId = randomUUID();
    const email = 'active@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'active');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(adminResendMock).not.toHaveBeenCalled();
    // The action did NOT log a row — rate-limit accounting only happens on
    // the allow-path.
    const log = await runAsService(async (db) => db.select().from(authResendLog));
    expect(log).toHaveLength(0);
  });

  it('returns forbidden when the user has no profile row', async () => {
    const userId = randomUUID();
    const email = 'orphan@example.com';
    await seedAuthUser(userId, email);
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(adminResendMock).not.toHaveBeenCalled();
  });

  it('resends the email and logs the attempt for a pending user with 0 prior sends', async () => {
    const userId = randomUUID();
    const email = 'pending@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
    adminResendMock.mockResolvedValue({ data: null, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: true });
    expect(adminResendMock).toHaveBeenCalledTimes(1);
    expect(adminResendMock).toHaveBeenCalledWith({ type: 'signup', email });

    const log = await runAsService(async (db) =>
      db.select().from(authResendLog).where(eq(authResendLog.userId, userId)),
    );
    expect(log).toHaveLength(1);
  });

  it('resends when the user has 1 prior send (under the limit)', async () => {
    const userId = randomUUID();
    const email = 'one@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    await runAsService(async (db) => {
      await db.insert(authResendLog).values({ userId });
    });
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
    adminResendMock.mockResolvedValue({ data: null, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: true });
    expect(adminResendMock).toHaveBeenCalledTimes(1);

    const log = await runAsService(async (db) =>
      db.select().from(authResendLog).where(eq(authResendLog.userId, userId)),
    );
    expect(log).toHaveLength(2);
  });

  it('returns rate_limited when the user already has 3 sends in the last 5 minutes', async () => {
    const userId = randomUUID();
    const email = 'limited@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    // Three recent sends — at the limit.
    await runAsService(async (db) => {
      await db.insert(authResendLog).values([{ userId }, { userId }, { userId }]);
    });
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: false, error: 'rate_limited' });
    // Crucial: no Supabase call AND no new log row.
    expect(adminResendMock).not.toHaveBeenCalled();
    const log = await runAsService(async (db) =>
      db.select().from(authResendLog).where(eq(authResendLog.userId, userId)),
    );
    expect(log).toHaveLength(3);
  });

  it('resends when the user has 3 sends but the oldest is >5 minutes ago (sliding window)', async () => {
    const userId = randomUUID();
    const email = 'sliding@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    // Two within the window + one OLDER than 5 minutes. The action should
    // count only the two recent ones (under the limit) and allow the
    // resend. We INSERT with explicit `sentAt` to control the window.
    await runAsService(async (db) => {
      await db.execute(
        sql`INSERT INTO auth_resend_log (user_id, sent_at)
            VALUES
              (${userId}, now() - interval '10 minutes'),
              (${userId}, now() - interval '1 minute'),
              (${userId}, now() - interval '30 seconds')`,
      );
    });
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
    adminResendMock.mockResolvedValue({ data: null, error: null });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: true });
    expect(adminResendMock).toHaveBeenCalledTimes(1);
  });

  it('returns unknown when Supabase resend errors', async () => {
    const userId = randomUUID();
    const email = 'fail@example.com';
    await seedAuthUser(userId, email);
    await seedProfile(userId, 'pending_verification');
    getUserMock.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
    adminResendMock.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', message: 'rate limit upstream' },
    });

    const { resendVerificationEmail } = await import('@/modules/auth');
    const result = await resendVerificationEmail();

    expect(result).toEqual({ ok: false, error: 'unknown' });
  });
});
