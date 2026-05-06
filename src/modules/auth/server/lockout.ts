import { eq, sql } from 'drizzle-orm';

import type { AppDb } from '@/shared/db/client';
import { profiles, type Profile } from '@/shared/db/schema/auth/tables';

// ---------------------------------------------------------------------------
// Lockout state machine
//
// This module is NOT exposed via the auth module barrel (`index.ts`). It is
// consumed only by the login Server Action and password-reset flows.
//
// All writes use atomic SQL so concurrent requests against the same user_id
// cannot corrupt counters or produce duplicate lockout events.
// ---------------------------------------------------------------------------

export interface LockoutResult {
  failedLoginCount: number;
  lockoutUntil: Date | null;
  requiresPasswordReset: boolean;
  /** True when THIS call was the one that triggered the lockout (count crossed threshold) */
  lockoutJustStarted: boolean;
}

/**
 * Records a failed login attempt for `userId` using the atomic UPDATE
 * documented in design.md D2.
 *
 * The SQL resets the counter to 1 if the previous failure was >15 min ago
 * (sliding window). When the counter reaches 5, it triggers a 30-min lockout
 * and increments `consecutive_lockouts`. Three consecutive lockouts require a
 * password reset.
 *
 * Returns the post-update state so the caller can decide whether to emit a
 * `lockout_started` auth_log entry and send the lockout notification email.
 */
export async function applyFailedLoginAttempt(db: AppDb, userId: string): Promise<LockoutResult> {
  const rows = await db.execute(sql`
    UPDATE ${profiles} SET
      failed_login_count = CASE
        WHEN ${profiles.lastFailedLoginAt} < NOW() - INTERVAL '15 minutes' THEN 1
        ELSE ${profiles.failedLoginCount} + 1
      END,
      last_failed_login_at = NOW(),
      lockout_until = CASE
        WHEN (CASE WHEN ${profiles.lastFailedLoginAt} < NOW() - INTERVAL '15 minutes' THEN 1 ELSE ${profiles.failedLoginCount} + 1 END) = 5
          THEN NOW() + INTERVAL '30 minutes'
        ELSE ${profiles.lockoutUntil}
      END,
      consecutive_lockouts = CASE
        WHEN (CASE WHEN ${profiles.lastFailedLoginAt} < NOW() - INTERVAL '15 minutes' THEN 1 ELSE ${profiles.failedLoginCount} + 1 END) = 5
          THEN ${profiles.consecutiveLockouts} + 1
        ELSE ${profiles.consecutiveLockouts}
      END,
      requires_password_reset = CASE
        WHEN (CASE WHEN ${profiles.lastFailedLoginAt} < NOW() - INTERVAL '15 minutes' THEN 1 ELSE ${profiles.failedLoginCount} + 1 END) = 5
          AND ${profiles.consecutiveLockouts} + 1 >= 3
          THEN true
        ELSE ${profiles.requiresPasswordReset}
      END
    WHERE ${profiles.userId} = ${userId}
    RETURNING
      ${profiles.failedLoginCount},
      ${profiles.lockoutUntil},
      ${profiles.consecutiveLockouts},
      ${profiles.requiresPasswordReset}
  `);

  const row = rows[0] as
    | {
        failed_login_count: number;
        lockout_until: string | null;
        consecutive_lockouts: number;
        requires_password_reset: boolean;
      }
    | undefined;

  if (!row) {
    throw new Error(`applyFailedLoginAttempt: no profile found for user_id=${userId}`);
  }

  const lockoutUntil = row.lockout_until ? new Date(row.lockout_until) : null;
  const failedLoginCount = row.failed_login_count;

  // Lockout just started if the count hit exactly 5 (the threshold).
  // Under concurrency, only the transaction that pushed count from 4→5 sees
  // exactly 5 — the next one sees 6, so this flag fires exactly once.
  const lockoutJustStarted = failedLoginCount === 5;

  return {
    failedLoginCount,
    lockoutUntil,
    requiresPasswordReset: row.requires_password_reset,
    lockoutJustStarted,
  };
}

/**
 * Resets all lockout-related counters for a user. Called on:
 *   - Successful login (clears failed attempts)
 *   - Successful password reset (clears everything including `requires_password_reset`)
 */
export async function resetLoginCounters(db: AppDb, userId: string): Promise<void> {
  await db
    .update(profiles)
    .set({
      failedLoginCount: 0,
      consecutiveLockouts: 0,
      lockoutUntil: null,
      lastFailedLoginAt: null,
      requiresPasswordReset: false,
    })
    .where(eq(profiles.userId, userId));
}

/**
 * Pure helper — checks whether a profile is currently locked out based on
 * the `lockoutUntil` timestamp.
 */
export function isCurrentlyLockedOut(profile: Pick<Profile, 'lockoutUntil'>): {
  lockedOut: boolean;
  until?: Date;
} {
  if (!profile.lockoutUntil) {
    return { lockedOut: false };
  }

  const until = new Date(profile.lockoutUntil);
  if (until > new Date()) {
    return { lockedOut: true, until };
  }

  return { lockedOut: false };
}
