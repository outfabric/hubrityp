import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authLogs, oauthIdentities, profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// `completeOAuthProfileImpl` is the Server Action that creates a profile for
// an OAuth user who has a session but no profile yet. It validates CRP/UF/
// consents, INSERTs into `profiles` and `oauth_identities`, logs
// `oauth_signup`, and redirects to `/onboarding/pending`.
//
// What is mocked vs real:
//   - `createServerClient` (mocked) — returns a fake Supabase client whose
//     `auth.getUser()` returns a controlled user object. No real GoTrue.
//   - `next/navigation` `redirect` — left UNMOCKED so the real
//     NEXT_REDIRECT marker is thrown on success.
//   - `next/headers` `headers` — left UNMOCKED; `logAuthEvent` handles
//     missing request context gracefully.
//   - Real `profiles`, `oauth_identities`, `auth_logs` tables are queried
//     directly via Drizzle.

const supabaseAuthGetUserMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: supabaseAuthGetUserMock,
    },
  }),
}));

function makeGoogleUser(overrides: Partial<{ id: string; email: string; fullName: string }> = {}) {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? `${randomUUID().replace(/-/g, '')}@test.local`;
  const googleIdentityId = randomUUID();
  return {
    id,
    email,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: overrides.fullName ?? 'Google User' },
    identities: [
      {
        id: googleIdentityId,
        user_id: id,
        provider: 'google',
        identity_data: { email },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };
}

function buildFormData(overrides: Record<string, unknown> = {}): FormData {
  const base = {
    fullName: 'Maria Silva',
    crpNumber: `06/${Math.floor(100000 + Math.random() * 900000)}`,
    crpUf: 'SP',
    acceptedTerms: 'on',
    acceptedPrivacy: 'on',
    acceptedSensitiveData: 'on',
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || value === null) continue;
    fd.set(key, String(value));
  }
  return fd;
}

beforeEach(() => {
  supabaseAuthGetUserMock.mockReset();
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

describe('completeOAuthProfileImpl Server Action (integration)', () => {
  describe('happy path', () => {
    it('creates profile + identity, status pending_crp_validation, logs oauth_signup', async () => {
      const user = makeGoogleUser();
      supabaseAuthGetUserMock.mockResolvedValue({ data: { user }, error: null });

      // Insert the auth.users row for the mocked OAuth user. The trigger
      // skips profile creation for OAuth users (provider != 'email').
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
               VALUES (${user.id}, '00000000-0000-0000-0000-000000000000',
                       'authenticated', 'authenticated', ${user.email},
                       '{"full_name":"Google User"}'::jsonb,
                       '{"provider":"google","providers":["google"]}'::jsonb)`,
        );
      });

      const formData = buildFormData();

      const { completeOAuthProfileImpl } =
        await import('@/modules/oauth/server/complete-oauth-profile');

      let caught: unknown = null;
      try {
        await completeOAuthProfileImpl(formData);
      } catch (err) {
        caught = err;
      }

      // Success redirects to /onboarding/pending.
      const digest = (caught as { digest?: string } | null)?.digest ?? '';
      expect(digest.startsWith('NEXT_REDIRECT')).toBe(true);
      expect(digest).toContain('/onboarding/pending');

      // Profile row was created.
      const [profile] = await runAsService(async (db) =>
        db.select().from(profiles).where(eq(profiles.userId, user.id)),
      );
      expect(profile).toBeDefined();
      expect(profile!.status).toBe('pending_crp_validation');
      expect(profile!.email).toBe(user.email);
      expect(profile!.emailVerifiedAt).not.toBeNull();

      // oauth_identities row was created.
      const [identity] = await runAsService(async (db) =>
        db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, user.id)),
      );
      expect(identity).toBeDefined();
      expect(identity!.provider).toBe('google');
      expect(identity!.isPrimary).toBe(true);

      // Audit log recorded oauth_signup.
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.userId, user.id)),
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.event).toBe('oauth_signup');
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.provider).toBe('google');
    });
  });

  describe('duplicate CRP', () => {
    it('returns duplicate_crp typed error', async () => {
      const crpNumber = `06/${Math.floor(100000 + Math.random() * 900000)}`;

      // Create a first auth.users + profile with this CRP. The profiles table
      // has a FK to auth.users, so the auth.users row must exist first.
      const firstUserId = randomUUID();
      const nowIso = new Date().toISOString();
      const metadata = JSON.stringify({
        fullName: 'First User',
        crpNumber,
        crpUf: 'SP',
        termsAcceptedAt: nowIso,
        privacyAcceptedAt: nowIso,
        sensitiveDataConsentAt: nowIso,
      });
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
               VALUES (${firstUserId}, '00000000-0000-0000-0000-000000000000',
                       'authenticated', 'authenticated', 'first@test.local', ${metadata}::jsonb)`,
        );
      });
      // The trigger creates the profile. Force status to active.
      await runAsService(async (db) => {
        await db.execute(
          dsql`UPDATE profiles SET status = 'active' WHERE user_id = ${firstUserId}`,
        );
      });

      // Now try to complete profile with the same CRP via OAuth.
      const user = makeGoogleUser();
      supabaseAuthGetUserMock.mockResolvedValue({ data: { user }, error: null });

      // Insert auth.users row for the second (OAuth) user.
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
               VALUES (${user.id}, '00000000-0000-0000-0000-000000000000',
                       'authenticated', 'authenticated', ${user.email},
                       '{"full_name":"Google User"}'::jsonb,
                       '{"provider":"google","providers":["google"]}'::jsonb)`,
        );
      });

      const formData = buildFormData({ crpNumber });

      const { completeOAuthProfileImpl } =
        await import('@/modules/oauth/server/complete-oauth-profile');
      const result = await completeOAuthProfileImpl(formData);

      expect(result).toEqual({ ok: false, error: 'duplicate_crp' });
    });
  });

  describe('invalid session', () => {
    it('returns invalid_session when no user', async () => {
      supabaseAuthGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

      const formData = buildFormData();

      const { completeOAuthProfileImpl } =
        await import('@/modules/oauth/server/complete-oauth-profile');
      const result = await completeOAuthProfileImpl(formData);

      expect(result).toEqual({ ok: false, error: 'invalid_session' });
    });
  });

  describe('invalid input', () => {
    it('returns invalid_input with field errors for missing consent', async () => {
      const user = makeGoogleUser();
      supabaseAuthGetUserMock.mockResolvedValue({ data: { user }, error: null });

      // Drop acceptedTerms.
      const formData = buildFormData();
      formData.delete('acceptedTerms');

      const { completeOAuthProfileImpl } =
        await import('@/modules/oauth/server/complete-oauth-profile');
      const result = await completeOAuthProfileImpl(formData);

      expect(result).toMatchObject({
        ok: false,
        error: 'invalid_input',
      });
      if (!result.ok && result.error === 'invalid_input') {
        expect(result.fieldErrors.acceptedTerms).toBeDefined();
      }
    });
  });
});
