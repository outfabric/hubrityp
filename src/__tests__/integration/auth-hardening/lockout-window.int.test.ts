import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { applyFailedLoginAttempt } from '@/modules/auth/server/lockout';
import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 5.5 — Sliding 15-minute window for failed login counter
//
// The atomic UPDATE resets `failed_login_count` to 1 when
// `last_failed_login_at` is older than 15 minutes. This test verifies:
//   - 4 failures → wait 16 min (simulated) → 1 more failure = no lockout
//     (counter reset to 1)
//   - 5 failures within 15 min = lockout triggered
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM profiles`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

async function createTestUser(suffix: string) {
  const userId = randomUUID();
  await runAsService(async (db) => {
    // Use provider:"google" so handle_new_user trigger skips auto-profile
    // creation — we insert the profile manually to control its initial state.
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${'window-' + suffix + '@test.local'}, '{"provider":"google"}'::jsonb)`,
    );
    await db.insert(profiles).values({
      userId,
      email: `window-${suffix}@test.local`,
      fullName: 'Window Test',
      crpNumber: `W${suffix}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
  return userId;
}

describe('applyFailedLoginAttempt — 15-minute sliding window (integration)', () => {
  it('resets counter when last failure is older than 15 minutes', async () => {
    const userId = await createTestUser('reset');

    // Apply 4 failures
    for (let i = 0; i < 4; i++) {
      await runAsService(async (db) => applyFailedLoginAttempt(db, userId));
    }

    // Verify count is 4
    const midState = await runAsService(async (db) => {
      const rows = await db
        .select({ failedLoginCount: profiles.failedLoginCount })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });
    expect(midState!.failedLoginCount).toBe(4);

    // Simulate 16 minutes passing by backdating `last_failed_login_at`
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE profiles
             SET last_failed_login_at = NOW() - INTERVAL '16 minutes'
             WHERE user_id = ${userId}`,
      );
    });

    // One more failure — should reset counter to 1, NOT reach 5
    const result = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));

    expect(result.failedLoginCount).toBe(1);
    expect(result.lockoutJustStarted).toBe(false);
    expect(result.lockoutUntil).toBeNull();
  });

  it('triggers lockout when 5 failures occur within 15 minutes', async () => {
    const userId = await createTestUser('within');

    // Apply 5 failures in quick succession (all within window)
    let lastResult = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));
    for (let i = 1; i < 5; i++) {
      lastResult = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));
    }

    expect(lastResult.failedLoginCount).toBe(5);
    expect(lastResult.lockoutJustStarted).toBe(true);
    expect(lastResult.lockoutUntil).toBeInstanceOf(Date);
    expect(lastResult.lockoutUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('counter stays at 1 after window expiry even with prior high count', async () => {
    const userId = await createTestUser('high-reset');

    // Simulate a previous state with count=4 and old timestamp
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE profiles
             SET failed_login_count = 4,
                 last_failed_login_at = NOW() - INTERVAL '20 minutes'
             WHERE user_id = ${userId}`,
      );
    });

    // New failure after window — resets to 1
    const result = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));

    expect(result.failedLoginCount).toBe(1);
    expect(result.lockoutJustStarted).toBe(false);
  });
});
