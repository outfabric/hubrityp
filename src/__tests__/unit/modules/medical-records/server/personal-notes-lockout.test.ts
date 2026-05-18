import { describe, expect, it } from 'vitest';

import {
  applyFailedAttempt,
  applySuccessfulVerification,
  assessLockout,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  type LockoutState,
} from '@/modules/medical-records/lib/personal-notes-lockout';

// ---------------------------------------------------------------------------
// assessLockout
// ---------------------------------------------------------------------------

describe('assessLockout', () => {
  it('returns unlocked when lockedUntil is null', () => {
    const state: LockoutState = { failedAttempts: 0, lockedUntil: null };
    const result = assessLockout(state);
    expect(result.status).toBe('unlocked');
  });

  it('returns unlocked when lockedUntil is in the past', () => {
    const pastDate = new Date(Date.now() - 60_000); // 1 minute ago
    const state: LockoutState = { failedAttempts: 5, lockedUntil: pastDate };
    const result = assessLockout(state);
    expect(result.status).toBe('unlocked');
  });

  it('returns locked when lockedUntil is in the future', () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    const state: LockoutState = { failedAttempts: 5, lockedUntil: futureDate };
    const result = assessLockout(state);

    expect(result.status).toBe('locked');
    if (result.status === 'locked') {
      expect(result.lockedUntilIso).toBe(futureDate.toISOString());
      expect(result.remainingMs).toBeGreaterThan(0);
    }
  });

  it('uses the provided `now` parameter for comparison', () => {
    const lockedUntil = new Date('2025-06-01T12:15:00.000Z');
    const nowBefore = new Date('2025-06-01T12:00:00.000Z');
    const nowAfter = new Date('2025-06-01T12:30:00.000Z');

    expect(assessLockout({ failedAttempts: 5, lockedUntil }, nowBefore).status).toBe('locked');
    expect(assessLockout({ failedAttempts: 5, lockedUntil }, nowAfter).status).toBe('unlocked');
  });
});

// ---------------------------------------------------------------------------
// applyFailedAttempt
// ---------------------------------------------------------------------------

describe('applyFailedAttempt', () => {
  it('increments failedAttempts by 1', () => {
    const state: LockoutState = { failedAttempts: 0, lockedUntil: null };
    const result = applyFailedAttempt(state);
    expect(result.failedAttempts).toBe(1);
  });

  it('does not trigger lockout below threshold', () => {
    const state: LockoutState = { failedAttempts: 3, lockedUntil: null };
    const result = applyFailedAttempt(state);
    expect(result.failedAttempts).toBe(4);
    expect(result.justLocked).toBe(false);
    expect(result.lockedUntil).toBeNull();
    expect(result.remainingAttempts).toBe(1);
  });

  it('triggers lockout on the 5th failed attempt', () => {
    const now = new Date('2025-06-01T12:00:00.000Z');
    const state: LockoutState = { failedAttempts: 4, lockedUntil: null };
    const result = applyFailedAttempt(state, now);

    expect(result.failedAttempts).toBe(5);
    expect(result.justLocked).toBe(true);
    expect(result.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT_DURATION_MS));
    expect(result.remainingAttempts).toBe(0);
  });

  it('triggers lockout again on subsequent failure when counter is already >= 5', () => {
    // After lockout expires, counter stays at 5 (not reset). A wrong password
    // at attempt 5 pushes to 6, which is >= MAX and sets a new lockout.
    const now = new Date('2025-06-01T13:00:00.000Z');
    const state: LockoutState = { failedAttempts: 5, lockedUntil: null };
    const result = applyFailedAttempt(state, now);

    expect(result.failedAttempts).toBe(6);
    expect(result.justLocked).toBe(true);
    expect(result.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT_DURATION_MS));
    expect(result.remainingAttempts).toBe(0);
  });

  it('returns remaining attempts correctly for each increment', () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      const state: LockoutState = { failedAttempts: i, lockedUntil: null };
      const result = applyFailedAttempt(state);
      expect(result.remainingAttempts).toBe(Math.max(0, MAX_FAILED_ATTEMPTS - (i + 1)));
    }
  });
});

// ---------------------------------------------------------------------------
// applySuccessfulVerification
// ---------------------------------------------------------------------------

describe('applySuccessfulVerification', () => {
  it('resets failedAttempts to 0', () => {
    const result = applySuccessfulVerification();
    expect(result.failedAttempts).toBe(0);
  });

  it('clears lockedUntil', () => {
    const result = applySuccessfulVerification();
    expect(result.lockedUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lockout state machine scenarios (end-to-end through pure helpers)
// ---------------------------------------------------------------------------

describe('lockout state machine scenarios', () => {
  it('5 failed attempts triggers lockout', () => {
    let state: LockoutState = { failedAttempts: 0, lockedUntil: null };
    const now = new Date('2025-06-01T12:00:00.000Z');

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      const result = applyFailedAttempt(state, now);
      state = { failedAttempts: result.failedAttempts, lockedUntil: result.lockedUntil };
    }

    expect(state.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state.lockedUntil).not.toBeNull();

    const lockStatus = assessLockout(state, now);
    expect(lockStatus.status).toBe('locked');
  });

  it('locked state rejects even with correct password (timing attack prevention)', () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    const state: LockoutState = { failedAttempts: 5, lockedUntil };

    // During lockout, assessLockout returns 'locked' — the server action
    // must reject before ever calling argon2.verify()
    const lockStatus = assessLockout(state);
    expect(lockStatus.status).toBe('locked');
  });

  it('after cooldown period, correct password succeeds and resets counter', () => {
    const lockedUntil = new Date('2025-06-01T12:15:00.000Z');
    const state: LockoutState = { failedAttempts: 5, lockedUntil };
    const afterCooldown = new Date('2025-06-01T12:30:00.000Z');

    // Lockout has expired
    const lockStatus = assessLockout(state, afterCooldown);
    expect(lockStatus.status).toBe('unlocked');

    // Correct password -> reset
    const resetState = applySuccessfulVerification();
    expect(resetState.failedAttempts).toBe(0);
    expect(resetState.lockedUntil).toBeNull();
  });

  it('wrong password after cooldown re-increments and can re-lock', () => {
    const lockedUntil = new Date('2025-06-01T12:15:00.000Z');
    let state: LockoutState = { failedAttempts: 5, lockedUntil };
    const afterCooldown = new Date('2025-06-01T12:30:00.000Z');

    // Lockout has expired
    expect(assessLockout(state, afterCooldown).status).toBe('unlocked');

    // Wrong password — counter was still at 5, now increments to 6, re-locks
    const failResult = applyFailedAttempt(state, afterCooldown);
    state = { failedAttempts: failResult.failedAttempts, lockedUntil: failResult.lockedUntil };

    expect(failResult.justLocked).toBe(true);
    expect(state.failedAttempts).toBe(6);
    expect(state.lockedUntil).toEqual(new Date(afterCooldown.getTime() + LOCKOUT_DURATION_MS));

    // Now locked again
    expect(assessLockout(state, afterCooldown).status).toBe('locked');
  });

  it('4 failed attempts does not trigger lockout, 1 more does', () => {
    const now = new Date('2025-06-01T12:00:00.000Z');
    let state: LockoutState = { failedAttempts: 0, lockedUntil: null };

    // 4 failures — not locked
    for (let i = 0; i < 4; i++) {
      const result = applyFailedAttempt(state, now);
      state = { failedAttempts: result.failedAttempts, lockedUntil: result.lockedUntil };
    }

    expect(state.failedAttempts).toBe(4);
    expect(assessLockout(state, now).status).toBe('unlocked');

    // 5th failure — now locked
    const finalResult = applyFailedAttempt(state, now);
    state = { failedAttempts: finalResult.failedAttempts, lockedUntil: finalResult.lockedUntil };

    expect(state.failedAttempts).toBe(5);
    expect(assessLockout(state, now).status).toBe('locked');
  });
});
