import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 7.6 — Integration tests for requestPasswordReset
//
// Tests:
//   - Happy path: existing email calls Supabase resetPasswordForEmail
//   - Non-existing email: same { ok: true } response, no Supabase call
//   - Malformed email: returns { ok: false, error: 'invalid_input' }
// ---------------------------------------------------------------------------

const resetPasswordForEmailMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  }),
}));

// Mock logAuthEvent to avoid DB writes during tests
vi.mock('@/modules/registration/server/log-auth-event', () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock headers
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ origin: 'http://localhost:3000' })),
}));

afterEach(async () => {
  vi.clearAllMocks();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM profiles`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('requestPasswordReset (integration)', () => {
  it('calls Supabase resetPasswordForEmail for existing email and returns { ok: true }', async () => {
    const userId = randomUUID();
    const email = `reset-test-${randomUUID().slice(0, 8)}@test.local`;

    // Seed a user + profile
    await runAsService(async (db) => {
      await db.execute(
        // Use provider:"google" so handle_new_user trigger skips auto-profile
        // creation — we insert the profile manually to control its initial state.
        dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
             VALUES (${userId}, ${email}, '{"provider":"google"}'::jsonb)`,
      );
      await db.insert(profiles).values({
        userId,
        email,
        fullName: 'Test User',
        crpNumber: `${10000 + Math.floor(Math.random() * 89999)}`,
        crpUf: 'SP',
        status: 'active',
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
        sensitiveDataConsentAt: new Date(),
      });
    });

    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });

    const { requestPasswordReset } = await import('@/app/(auth)/forgot-password/actions');

    const result = await requestPasswordReset(buildFormData({ email }));

    expect(result).toEqual({ ok: true });
    expect(resetPasswordForEmailMock).toHaveBeenCalledOnce();
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(email, {
      redirectTo: expect.stringContaining('/auth/callback?next=/reset-password'),
    });
  });

  it('returns { ok: true } for non-existing email without calling Supabase', async () => {
    const fakeEmail = `nonexistent-${randomUUID().slice(0, 8)}@test.local`;

    const { requestPasswordReset } = await import('@/app/(auth)/forgot-password/actions');

    const result = await requestPasswordReset(buildFormData({ email: fakeEmail }));

    expect(result).toEqual({ ok: true });
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error: "invalid_input" } for malformed email', async () => {
    const { requestPasswordReset } = await import('@/app/(auth)/forgot-password/actions');

    const result = await requestPasswordReset(buildFormData({ email: 'not-an-email' }));

    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it('returns { ok: true } even when Supabase returns a rate-limit error', async () => {
    const userId = randomUUID();
    const email = `ratelimit-${randomUUID().slice(0, 8)}@test.local`;

    await runAsService(async (db) => {
      await db.execute(
        // Use provider:"google" so handle_new_user trigger skips auto-profile
        // creation — we insert the profile manually to control its initial state.
        dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
             VALUES (${userId}, ${email}, '{"provider":"google"}'::jsonb)`,
      );
      await db.insert(profiles).values({
        userId,
        email,
        fullName: 'Test User',
        crpNumber: `${10000 + Math.floor(Math.random() * 89999)}`,
        crpUf: 'SP',
        status: 'active',
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
        sensitiveDataConsentAt: new Date(),
      });
    });

    resetPasswordForEmailMock.mockResolvedValue({
      data: {},
      error: { name: 'AuthApiError', message: 'Rate limit exceeded', status: 429 },
    });

    const { requestPasswordReset } = await import('@/app/(auth)/forgot-password/actions');

    const result = await requestPasswordReset(buildFormData({ email }));

    expect(result).toEqual({ ok: true });
  });
});
