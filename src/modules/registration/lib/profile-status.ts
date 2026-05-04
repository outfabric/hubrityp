/**
 * Profile lifecycle status enum + transition guard.
 *
 * The five statuses track the user's path from signup through email
 * confirmation, CRP validation, active use, and eventual suspension or
 * cancellation. Statuses are stored as snake-cased strings (matching the
 * Drizzle schema's CHECK constraint) so the same values flow unchanged
 * between Postgres, Server Actions, and the client.
 *
 * Pure module — no DB access here, just the type and the guard. The DB
 * trigger and Server Actions are expected to call `canTransition(...)`
 * before applying any status change, so invalid edges are rejected at the
 * application layer regardless of who initiated the change.
 */

/** Snake-cased status values stored in `profiles.status`. */
export const ProfileStatus = {
  PendingVerification: 'pending_verification',
  PendingCrpValidation: 'pending_crp_validation',
  Active: 'active',
  Suspended: 'suspended',
  Cancelled: 'cancelled',
} as const;

export type ProfileStatus = (typeof ProfileStatus)[keyof typeof ProfileStatus];

/**
 * Allowed status transitions (per `design.md` D2):
 *
 *   pending_verification    → pending_crp_validation   (email confirmed)
 *   pending_crp_validation  → active                   (admin validated)
 *   active                  → suspended                (admin action)
 *   *                       → cancelled                (user delete)
 *
 * Self-loops (e.g. `active → active`) and reverse edges
 * (e.g. `active → pending_verification`) are NOT allowed and return
 * `false`. The `cancelled` status is terminal — nothing transitions out
 * of it.
 */
type TransitionKey = `${ProfileStatus}->${ProfileStatus}`;

const ALLOWED_TRANSITIONS: ReadonlySet<TransitionKey> = new Set<TransitionKey>([
  // email confirmation flow
  `${ProfileStatus.PendingVerification}->${ProfileStatus.PendingCrpValidation}`,
  // CRP validation flow
  `${ProfileStatus.PendingCrpValidation}->${ProfileStatus.Active}`,
  // admin suspension
  `${ProfileStatus.Active}->${ProfileStatus.Suspended}`,
  // user-initiated cancellation, allowed from any non-cancelled status
  `${ProfileStatus.PendingVerification}->${ProfileStatus.Cancelled}`,
  `${ProfileStatus.PendingCrpValidation}->${ProfileStatus.Cancelled}`,
  `${ProfileStatus.Active}->${ProfileStatus.Cancelled}`,
  `${ProfileStatus.Suspended}->${ProfileStatus.Cancelled}`,
]);

/**
 * Returns `true` iff `from -> to` is an allowed transition. Self-loops and
 * unlisted edges always return `false`.
 */
export function canTransition(from: ProfileStatus, to: ProfileStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS.has(`${from}->${to}`);
}
