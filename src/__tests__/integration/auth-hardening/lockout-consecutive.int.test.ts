import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { applyFailedLoginAttempt, resetLoginCounters } from '@/modules/auth/server/lockout';
import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// 5.6 — Consecutive lockouts escalation → requires_password_reset
//
// After 3 consecutive lockouts (each triggered by 5 failures within 15 min,
// followed by a reset), the profile's `requires_password_reset` flag is set
// to true. Resetting via `resetLoginCounters` clears everything.
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
           VALUES (${userId}, ${'consecutive-' + suffix + '@test.local'}, '{"provider":"google"}'::jsonb)`,
    );
    await db.insert(profiles).values({
      userId,
      email: `consecutive-${suffix}@test.local`,
      fullName: 'Consecutive Test',
      crpNumber: `C${suffix}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
  return userId;
}

/**
 * Trigger a single lockout cycle: 5 failed attempts within window.
 * Returns the result of the 5th attempt (which triggers lockout).
 */
async function triggerLockout(userId: string) {
  let result = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));
  for (let i = 1; i < 5; i++) {
    result = await runAsService(async (db) => applyFailedLoginAttempt(db, userId));
  }
  return result;
}

describe('applyFailedLoginAttempt — consecutive lockouts escalation (integration)', () => {
  it('3 consecutive lockouts set requires_password_reset=true', async () => {
    const userId = await createTestUser('escalate');

    // --- Lockout #1 ---
    const lockout1 = await triggerLockout(userId);
    expect(lockout1.lockoutJustStarted).toBe(true);
    expect(lockout1.requiresPasswordReset).toBe(false);

    // Simulate "lockout expired" by clearing the lockout timer but keeping
    // consecutive_lockouts intact. In production, the user would simply wait
    // 30 min. We use resetLoginCounters to simulate the user NOT doing a
    // password reset (just waiting out the lockout), then failing again.
    // However, the spec says `resetLoginCounters` is called on successful
    // login — but for this test, we need to simulate "lockout expires, user
    // tries again, fails again". The simplest approach: manually reset only
    // `failed_login_count` and `lockout_until` while preserving
    // `consecutive_lockouts`.
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE profiles
             SET failed_login_count = 0,
                 lockout_until = NULL,
                 last_failed_login_at = NULL
             WHERE user_id = ${userId}`,
      );
    });

    // --- Lockout #2 ---
    const lockout2 = await triggerLockout(userId);
    expect(lockout2.lockoutJustStarted).toBe(true);
    expect(lockout2.requiresPasswordReset).toBe(false);

    // Verify consecutive_lockouts = 2 at this point
    const midState = await runAsService(async (db) => {
      const rows = await db
        .select({ consecutiveLockouts: profiles.consecutiveLockouts })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });
    expect(midState!.consecutiveLockouts).toBe(2);

    // Again simulate lockout expiry (preserve consecutive_lockouts)
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE profiles
             SET failed_login_count = 0,
                 lockout_until = NULL,
                 last_failed_login_at = NULL
             WHERE user_id = ${userId}`,
      );
    });

    // --- Lockout #3 ---
    const lockout3 = await triggerLockout(userId);
    expect(lockout3.lockoutJustStarted).toBe(true);
    // After the 3rd lockout, requires_password_reset should be true
    expect(lockout3.requiresPasswordReset).toBe(true);

    // Verify final DB state
    const finalState = await runAsService(async (db) => {
      const rows = await db
        .select({
          consecutiveLockouts: profiles.consecutiveLockouts,
          requiresPasswordReset: profiles.requiresPasswordReset,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });
    expect(finalState!.consecutiveLockouts).toBe(3);
    expect(finalState!.requiresPasswordReset).toBe(true);
  });

  it('resetLoginCounters clears all lockout state including requires_password_reset', async () => {
    const userId = await createTestUser('full-reset');

    // Trigger 3 lockouts to set requires_password_reset
    for (let cycle = 0; cycle < 3; cycle++) {
      await triggerLockout(userId);
      if (cycle < 2) {
        // Partial reset between lockouts (simulate lockout expiry)
        await runAsService(async (db) => {
          await db.execute(
            dsql`UPDATE profiles
                 SET failed_login_count = 0,
                     lockout_until = NULL,
                     last_failed_login_at = NULL
                 WHERE user_id = ${userId}`,
          );
        });
      }
    }

    // Verify requires_password_reset is set
    const beforeReset = await runAsService(async (db) => {
      const rows = await db
        .select({ requiresPasswordReset: profiles.requiresPasswordReset })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });
    expect(beforeReset!.requiresPasswordReset).toBe(true);

    // Call resetLoginCounters (simulates successful password reset)
    await runAsService(async (db) => resetLoginCounters(db, userId));

    // Verify everything is cleared
    const afterReset = await runAsService(async (db) => {
      const rows = await db
        .select({
          failedLoginCount: profiles.failedLoginCount,
          consecutiveLockouts: profiles.consecutiveLockouts,
          lockoutUntil: profiles.lockoutUntil,
          lastFailedLoginAt: profiles.lastFailedLoginAt,
          requiresPasswordReset: profiles.requiresPasswordReset,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });

    expect(afterReset!.failedLoginCount).toBe(0);
    expect(afterReset!.consecutiveLockouts).toBe(0);
    expect(afterReset!.lockoutUntil).toBeNull();
    expect(afterReset!.lastFailedLoginAt).toBeNull();
    expect(afterReset!.requiresPasswordReset).toBe(false);
  });

  it('2 lockouts do NOT set requires_password_reset', async () => {
    const userId = await createTestUser('two-only');

    // Lockout #1
    await triggerLockout(userId);
    await runAsService(async (db) => {
      await db.execute(
        dsql`UPDATE profiles
             SET failed_login_count = 0,
                 lockout_until = NULL,
                 last_failed_login_at = NULL
             WHERE user_id = ${userId}`,
      );
    });

    // Lockout #2
    const result = await triggerLockout(userId);
    expect(result.requiresPasswordReset).toBe(false);

    const state = await runAsService(async (db) => {
      const rows = await db
        .select({
          consecutiveLockouts: profiles.consecutiveLockouts,
          requiresPasswordReset: profiles.requiresPasswordReset,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      return rows[0];
    });
    expect(state!.consecutiveLockouts).toBe(2);
    expect(state!.requiresPasswordReset).toBe(false);
  });
});
