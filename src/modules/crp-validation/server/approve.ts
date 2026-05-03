import 'server-only';

import { eq } from 'drizzle-orm';

import { applyTransition } from '@/modules/account-lifecycle';
import { db } from '@/shared/db/client';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { logger } from '@/shared/lib/logger';

// Discriminated union returned to the route shell / admin caller. Errors are
// typed string literals (no `Error` instances) so the result stays
// serializable across the Server Action boundary and consumers can narrow
// exhaustively.
//
// Variants:
//   - `forbidden` — caller is not service-role. The MVP admin path is
//     service-role only (see design.md "Open Questions"). Until a real admin
//     role exists, the gate is "did the caller present a service-role
//     context?".
//   - `queue_not_found` — the supplied queue id does not match any row.
//   - `already_decided` — the queue row exists but is no longer `pending`.
//   - `invalid_transition` — the queue row is `pending` but the user's
//     profile is in a state from which `crp_approved` is not a legal
//     transition (e.g. user already cancelled). The DB transaction is
//     rolled back; nothing changes.
//   - `profile_not_found` — the queue row references a user with no
//     `psychologist_profiles` row. Should not happen in practice (the queue
//     is populated at signup, after the profile is inserted), but we surface
//     it for debuggability.
//   - `unknown` — an unexpected throw. Logged at WARN and surfaced opaquely.
export type ApproveResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'queue_not_found'
        | 'already_decided'
        | 'invalid_transition'
        | 'profile_not_found'
        | 'unknown';
    };

// Arguments are explicit so the function is trivially testable: the
// integration test simply passes `isServiceRole: true` to exercise the happy
// path and `false` to exercise the gate. The route shell that wires this
// into a real admin tool is responsible for setting `isServiceRole` only
// when the caller's session JWT actually presents the service role.
//
// `actorUserId` is the admin's user id — captured for audit (`decided_by`).
export type ApproveCrpValidationArgs = {
  queueId: string;
  actorUserId: string;
  isServiceRole: boolean;
};

// Module-side implementation of the `approveCrpValidation` Server Action.
// This file MUST NOT carry a top-level `'use server'` directive — the route
// shell that wires this into Next is the only place where the Server Action
// boundary is declared. Marking the module as `'use server'` would force
// every export (and transitively every import) to be RPC-able and would
// couple the implementation to the action runtime.
export async function approveCrpValidationImpl(
  args: ApproveCrpValidationArgs,
): Promise<ApproveResult> {
  const { queueId, actorUserId, isServiceRole } = args;

  if (!isServiceRole) {
    logger.warn(
      { event: 'crp_validation_decided', decision: 'forbidden', queueId, actorUserId },
      'non-service-role caller blocked from approving CRP validation',
    );
    return { ok: false, error: 'forbidden' };
  }

  try {
    return await db.transaction(async (tx) => {
      // 1. Load the queue row inside the transaction so `already_decided`
      //    races (two admins clicking approve at once) settle on the row
      //    lock rather than producing duplicate transitions.
      const queueRows = await tx
        .select({
          id: crpValidationQueue.id,
          userId: crpValidationQueue.userId,
          status: crpValidationQueue.status,
        })
        .from(crpValidationQueue)
        .where(eq(crpValidationQueue.id, queueId))
        .limit(1);

      const queueRow = queueRows[0];
      if (!queueRow) {
        return { ok: false, error: 'queue_not_found' as const };
      }
      if (queueRow.status !== 'pending') {
        return { ok: false, error: 'already_decided' as const };
      }

      // 2. Mark the queue row decided. Note: this is the queue table's own
      //    `status` column (`pending` | `approved` | `rejected`), NOT the
      //    psychologist_profiles lifecycle status. The lifecycle status is
      //    driven by `applyTransition` below, which is the single writer of
      //    that column per the account-lifecycle spec.
      await tx
        .update(crpValidationQueue)
        .set({
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: actorUserId,
        })
        .where(eq(crpValidationQueue.id, queueId));

      // 3. Drive the profile lifecycle through the canonical helper. If the
      //    profile is in an unexpected state (e.g. already `active` due to a
      //    prior approval that did not also flip the queue row, or
      //    `cancelled` because the user gave up), `applyTransition` reports
      //    `invalid_transition` / `profile_not_found` and we ROLLBACK the
      //    queue update by throwing — Drizzle propagates the throw out of
      //    `db.transaction` as a rollback signal, then we map it to the
      //    typed error below.
      //
      //    We pass the outer `tx` through so `applyTransition` reuses our
      //    transaction instead of opening its own. With `postgres({ max: 1 })`
      //    nesting `db.transaction` inside an outer transaction deadlocks:
      //    the inner call waits forever on the connection the outer holds
      //    while the outer holds a row lock on `psychologist_profiles`.
      const transitionResult = await applyTransition(queueRow.userId, 'crp_approved', tx);
      if (!transitionResult.ok) {
        // Throw to roll back the queue UPDATE. The caught error below
        // distinguishes the two non-ok variants and surfaces them as typed
        // failures.
        throw new TransitionRollback(transitionResult.error);
      }

      // 4. Audit log. LGPD-safe: identifiers and decision only, no PII.
      logger.info(
        {
          event: 'crp_validation_decided',
          decision: 'approved',
          queueId,
          userId: queueRow.userId,
          actorUserId,
        },
        'CRP validation approved',
      );

      return { ok: true as const };
    });
  } catch (err) {
    if (err instanceof TransitionRollback) {
      logger.warn(
        {
          event: 'crp_validation_decided',
          decision: 'approve_rolled_back',
          reason: err.transitionError,
          queueId,
          actorUserId,
        },
        'CRP approval rolled back: profile transition failed',
      );
      return { ok: false, error: err.transitionError };
    }
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      {
        event: 'crp_validation_decided',
        decision: 'approve_unknown_error',
        errorName: name,
        queueId,
        actorUserId,
      },
      'CRP approval failed with unknown error',
    );
    return { ok: false, error: 'unknown' };
  }
}

// Internal sentinel: an Error subclass we use exclusively to bail out of the
// `db.transaction` callback when `applyTransition` reports a typed failure.
// Drizzle treats any throw as a rollback signal; using a custom class lets
// the `catch` block distinguish "the transition layer rejected this" from a
// genuine unexpected throw (network, DB error, etc.) without swallowing the
// latter.
class TransitionRollback extends Error {
  constructor(public readonly transitionError: 'invalid_transition' | 'profile_not_found') {
    super(`transition rollback: ${transitionError}`);
    this.name = 'TransitionRollback';
  }
}
