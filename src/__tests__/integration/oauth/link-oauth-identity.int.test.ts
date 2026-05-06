import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authLogs, oauthIdentities, profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// `linkOAuthIdentityImpl` is the Server Action that links a Google OAuth
// identity to an existing traditional (email/password) account.
//
// What is mocked:
//   - `@supabase/supabase-js` `createClient` (mocked) — provides the admin
//     client for `getUserById` and `deleteUser`, and the isolated client for
//     `signInWithPassword`. Both are wired to controlled responses.
//   - `@/shared/supabase/server` `createServerClient` — not needed by this
//     action (it uses the isolated client), but mocked to prevent import errors.
//   - `next/navigation` `redirect` — left UNMOCKED for NEXT_REDIRECT assertion.

const adminGetUserByIdMock = vi.fn();
const adminDeleteUserMock = vi.fn();
const signInWithPasswordMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    // Service-role key creates admin client; anon key creates isolated client.
    if (key === 'test-service-role-key') {
      return {
        auth: {
          admin: {
            getUserById: adminGetUserByIdMock,
            deleteUser: adminDeleteUserMock,
          },
        },
      };
    }
    // Anon key — isolated client for password verification.
    return {
      auth: {
        signInWithPassword: signInWithPasswordMock,
      },
    };
  },
}));

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  }),
}));

// The env module uses `process.env` — set test values before the module loads.
vi.mock('@/shared/env', () => {
  // eslint-disable-next-line no-restricted-syntax -- test needs real DATABASE_URL
  const dbUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/test';
  return {
    serverEnv: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      DATABASE_URL: dbUrl,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
  };
});

function buildFormData(password: string, pendingUserId: string): FormData {
  const fd = new FormData();
  fd.set('password', password);
  fd.set('pendingUserId', pendingUserId);
  return fd;
}

const TRADITIONAL_USER_ID = randomUUID();
const TRADITIONAL_EMAIL = `traditional-${randomUUID().slice(0, 8)}@test.local`;
const PENDING_USER_ID = randomUUID();
const GOOGLE_IDENTITY_ID = randomUUID();

beforeEach(async () => {
  adminGetUserByIdMock.mockReset();
  adminDeleteUserMock.mockReset();
  signInWithPasswordMock.mockReset();

  // Default: admin.getUserById returns a pending OAuth user with Google identity.
  adminGetUserByIdMock.mockResolvedValue({
    data: {
      user: {
        id: PENDING_USER_ID,
        email: TRADITIONAL_EMAIL,
        app_metadata: { provider: 'google', providers: ['google'] },
        identities: [
          {
            id: GOOGLE_IDENTITY_ID,
            provider: 'google',
            user_id: PENDING_USER_ID,
          },
        ],
      },
    },
    error: null,
  });

  adminDeleteUserMock.mockResolvedValue({ data: { user: { id: PENDING_USER_ID } }, error: null });

  // Seed a traditional auth.users + profile for the test. The profiles table
  // has a FK to auth.users, so the auth.users row must exist first.
  const nowIso = new Date().toISOString();
  const metadata = JSON.stringify({
    fullName: 'Traditional User',
    crpNumber: `06/${Math.floor(100000 + Math.random() * 900000)}`,
    crpUf: 'SP',
    termsAcceptedAt: nowIso,
    privacyAcceptedAt: nowIso,
    sensitiveDataConsentAt: nowIso,
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
           VALUES (${TRADITIONAL_USER_ID}, '00000000-0000-0000-0000-000000000000',
                   'authenticated', 'authenticated', ${TRADITIONAL_EMAIL}, ${metadata}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
  // The trigger should have created the profiles row. Force it to 'active'.
  await runAsService(async (db) => {
    await db.execute(
      dsql`UPDATE profiles SET status = 'active' WHERE user_id = ${TRADITIONAL_USER_ID}`,
    );
  });
});

afterEach(async () => {
  vi.resetModules();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM oauth_identities`);
    await db.execute(dsql`DELETE FROM auth_logs`);
    // auth.users cascade deletes profiles, so delete auth.users.
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('linkOAuthIdentityImpl Server Action (integration)', () => {
  describe('correct password', () => {
    it('links identity, deletes pending user, logs social_linked, redirects', async () => {
      signInWithPasswordMock.mockResolvedValue({
        data: { user: { id: TRADITIONAL_USER_ID }, session: {} },
        error: null,
      });

      const formData = buildFormData('CorrectPassword!1', PENDING_USER_ID);

      const { linkOAuthIdentityImpl } = await import('@/modules/oauth/server/link-oauth-identity');

      let caught: unknown = null;
      try {
        await linkOAuthIdentityImpl(formData);
      } catch (err) {
        caught = err;
      }

      // Should redirect to /login?banner=account_linked.
      const digest = (caught as { digest?: string } | null)?.digest ?? '';
      expect(digest.startsWith('NEXT_REDIRECT')).toBe(true);
      expect(digest).toContain('/login');
      expect(digest).toContain('banner=account_linked');

      // Pending user was deleted.
      expect(adminDeleteUserMock).toHaveBeenCalledWith(PENDING_USER_ID);

      // oauth_identities row created for the traditional user.
      const [identity] = await runAsService(async (db) =>
        db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, TRADITIONAL_USER_ID)),
      );
      expect(identity).toBeDefined();
      expect(identity!.provider).toBe('google');
      expect(identity!.providerUserId).toBe(GOOGLE_IDENTITY_ID);

      // Audit log: social_linked.
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.event, 'social_linked')),
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.userId).toBe(TRADITIONAL_USER_ID);
    });
  });

  describe('incorrect password', () => {
    it('returns invalid_credentials and increments counter', async () => {
      signInWithPasswordMock.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', name: 'AuthApiError' },
      });

      const formData = buildFormData('WrongPassword!1', PENDING_USER_ID);

      const { linkOAuthIdentityImpl } = await import('@/modules/oauth/server/link-oauth-identity');
      const result = await linkOAuthIdentityImpl(formData);

      expect(result).toEqual({ ok: false, error: 'invalid_credentials' });

      // Audit log: login_failure with source=link_account.
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.event, 'login_failure')),
      );
      expect(auditRows).toHaveLength(1);
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.source).toBe('link_account');

      // Failed login counter should be incremented.
      const [profile] = await runAsService(async (db) =>
        db
          .select({ failedLoginCount: profiles.failedLoginCount })
          .from(profiles)
          .where(eq(profiles.userId, TRADITIONAL_USER_ID)),
      );
      expect(profile!.failedLoginCount).toBe(1);
    });
  });

  describe('stale pending user', () => {
    it('returns invalid_link_request when pending user not found', async () => {
      adminGetUserByIdMock.mockResolvedValue({
        data: { user: null },
        error: { message: 'User not found', name: 'AuthApiError' },
      });

      const formData = buildFormData('AnyPassword!1', randomUUID());

      const { linkOAuthIdentityImpl } = await import('@/modules/oauth/server/link-oauth-identity');
      const result = await linkOAuthIdentityImpl(formData);

      expect(result).toEqual({ ok: false, error: 'invalid_link_request' });
    });
  });
});
