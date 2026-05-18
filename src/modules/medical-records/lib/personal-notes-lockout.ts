// Pure lockout state-machine logic for personal notes.
//
// Extracted from the server action so it can be unit-tested without a
// database. The server action feeds current DB state into these functions
// and applies the returned mutations.
//
// State machine (per patient_id):
//   UNLOCKED  ─wrong pw─→  INCREMENT  ─>=5─→  LOCKED (locked_until = now+15min)
//   LOCKED    ─any attempt─→  REJECTED (do not verify hash)
//   COOLDOWN_EXPIRED  ─correct pw─→  UNLOCKED (reset counter)
//   COOLDOWN_EXPIRED  ─wrong pw─→  INCREMENT (can re-lock)
//
// Counter resets ONLY on successful verification.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of failed attempts before lockout triggers. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Lockout duration in milliseconds (15 minutes). */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// State assessment
// ---------------------------------------------------------------------------

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export type LockoutStatus =
  | { status: 'unlocked' }
  | { status: 'locked'; lockedUntilIso: string; remainingMs: number };

/**
 * Determines whether the notes are currently locked based on the persisted
 * lockout state and the current time.
 *
 * During lockout, ALL attempts are rejected — even with the correct password.
 * This prevents timing-based verification attacks.
 */
export function assessLockout(state: LockoutState, now: Date = new Date()): LockoutStatus {
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    return {
      status: 'locked',
      lockedUntilIso: state.lockedUntil.toISOString(),
      remainingMs: state.lockedUntil.getTime() - now.getTime(),
    };
  }
  return { status: 'unlocked' };
}

// ---------------------------------------------------------------------------
// Transition: failed password
// ---------------------------------------------------------------------------

export interface FailedAttemptResult {
  failedAttempts: number;
  lockedUntil: Date | null;
  justLocked: boolean;
  remainingAttempts: number;
}

/**
 * Computes the next state after a failed password verification.
 *
 * If the new `failedAttempts` count reaches `MAX_FAILED_ATTEMPTS`, the
 * function returns a `lockedUntil` timestamp 15 minutes from `now`.
 */
export function applyFailedAttempt(
  state: LockoutState,
  now: Date = new Date(),
): FailedAttemptResult {
  const newCount = state.failedAttempts + 1;
  const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;

  return {
    failedAttempts: newCount,
    lockedUntil: shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : state.lockedUntil,
    justLocked: shouldLock,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - newCount),
  };
}

// ---------------------------------------------------------------------------
// Transition: successful password
// ---------------------------------------------------------------------------

export interface SuccessResult {
  failedAttempts: 0;
  lockedUntil: null;
}

/**
 * Returns the reset state after a successful password verification.
 * Counter resets to 0 and lockout is cleared.
 */
export function applySuccessfulVerification(): SuccessResult {
  return { failedAttempts: 0, lockedUntil: null };
}
