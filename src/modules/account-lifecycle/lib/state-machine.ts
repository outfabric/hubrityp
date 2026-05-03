// Pure state machine for the psychologist account lifecycle.
//
// This module is the **single writer** of `psychologist_profiles.status`. The
// spec ("`transitionStatus` helper is the single writer of `status`") forbids
// direct UPDATEs against the column anywhere else in `src/`. A unit test
// (`no-direct-status-writes.test.ts`) greps the codebase to enforce this.
//
// The function is intentionally side-effect-free: callers (Server Actions,
// Route Handlers, admin actions, jobs) wrap it with the persistence layer in
// `../server/transition.ts`. Keeping the transition table pure means it can
// be exercised exhaustively in unit tests without any DB or Supabase mocks.

// Five-state account lifecycle. Mirrors the CHECK constraint on
// `psychologist_profiles.status` exactly — any change here MUST be paired
// with a Drizzle migration adjusting the constraint.
export type AccountStatus =
  | 'pending_verification'
  | 'pending_crp_validation'
  | 'active'
  | 'suspended'
  | 'cancelled';

// Lifecycle events that can drive a transition. Each event has at most one
// valid origin status (see the table below); the helper rejects every other
// `(from, event)` pair as `invalid_transition`.
export type TransitionEvent =
  | 'email_verified'
  | 'crp_approved'
  | 'crp_rejected'
  | 'admin_suspend'
  | 'user_cancel'
  | 'admin_reinstate';

// Discriminated union returned by `transitionStatus`. The union is also the
// shape returned by `applyTransition` after a DB write, so the page-level
// caller has a single shape to switch on. Errors are typed string literals
// (no `Error` instances) so the result stays serializable across the
// Server Action boundary.
export type TransitionResult =
  | { ok: true; status: AccountStatus }
  | { ok: false; error: 'invalid_transition' }
  | { ok: false; error: 'profile_not_found' };

// The full transition table. Reading top-to-bottom mirrors the table in the
// spec (Requirement: "transitionStatus helper is the single writer of
// status"). Adding a new event MUST also extend `TransitionEvent` above.
const TRANSITIONS = {
  pending_verification: {
    email_verified: 'pending_crp_validation',
  },
  pending_crp_validation: {
    crp_approved: 'active',
    crp_rejected: 'suspended',
  },
  active: {
    admin_suspend: 'suspended',
    user_cancel: 'cancelled',
  },
  suspended: {
    admin_reinstate: 'active',
  },
  cancelled: {},
} as const satisfies {
  [From in AccountStatus]: Partial<Record<TransitionEvent, AccountStatus>>;
};

export function transitionStatus(current: AccountStatus, event: TransitionEvent): TransitionResult {
  // The cast is safe: `TRANSITIONS[current]` is a `Partial<Record<TransitionEvent, AccountStatus>>`.
  const next = (TRANSITIONS[current] as Partial<Record<TransitionEvent, AccountStatus>>)[event];
  if (next === undefined) {
    return { ok: false, error: 'invalid_transition' };
  }
  return { ok: true, status: next };
}
