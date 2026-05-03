import 'server-only';

import { eq } from 'drizzle-orm';

import { applyTransition } from '@/modules/account-lifecycle';
import { db } from '@/shared/db/client';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { logger } from '@/shared/lib/logger';

// See `./approve.ts` for the full rationale of the discriminated-union
// approach. The reject path adds one variant on top of the approve path:
// `reason_required` — the spec mandates a non-empty reason on rejection
// ("Rejection requires a reason"), and we trim before checking so a
// whitespace-only string is treated as empty.
export type RejectResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'reason_required'
        | 'queue_not_found'
        | 'already_decided'
        | 'invalid_transition'
        | 'profile_not_found'
        | 'unknown';
    };

export type RejectCrpValidationArgs = {
  queueId: string;
  actorUserId: string;
  reason: string;
  isServiceRole: boolean;
};

// Module-side implementation of the `rejectCrpValidation` Server Action.
// This file MUST NOT carry a top-level `'use server'` directive — see
// `./approve.ts` for the rationale.
export async function rejectCrpValidationImpl(
  args: RejectCrpValidationArgs,
): Promise<RejectResult> {
  const { queueId, actorUserId, reason, isServiceRole } = args;

  if (!isServiceRole) {
    logger.warn(
      { event: 'crp_validation_decided', decision: 'forbidden', queueId, actorUserId },
      'non-service-role caller blocked from rejecting CRP validation',
    );
    return { ok: false, error: 'forbidden' };
  }

  // Validate the reason BEFORE opening a transaction. `.trim()` ensures
  // whitespace-only input ('   ', '\t\n') is rejected too. The trimmed
  // string is what we persist below, so the spec audit trail never carries
  // accidental leading/trailing whitespace.
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { ok: false, error: 'reason_required' };
  }

  try {
    return await db.transaction(async (tx) => {
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

      await tx
        .update(crpValidationQueue)
        .set({
          status: 'rejected',
          decidedAt: new Date(),
          decidedBy: actorUserId,
          rejectionReason: trimmedReason,
        })
        .where(eq(crpValidationQueue.id, queueId));

      // Drive the profile lifecycle. Spec invariant: `crp_rejected` must
      // move `pending_crp_validation → suspended`. If the profile is in an
      // unexpected state, we roll back the queue UPDATE by throwing.
      //
      // We pass the outer `tx` through so `applyTransition` reuses our
      // transaction instead of opening its own — see `./approve.ts` for the
      // deadlock rationale (postgres-js `max: 1` + nested `db.transaction`).
      const transitionResult = await applyTransition(queueRow.userId, 'crp_rejected', tx);
      if (!transitionResult.ok) {
        throw new TransitionRollback(transitionResult.error);
      }

      // Audit log. LGPD-safe: we deliberately do NOT log the rejection
      // reason — admins write free text there ("CRP não localizado", etc.),
      // which could in theory leak personal context. Only the decision and
      // identifiers are logged.
      logger.info(
        {
          event: 'crp_validation_decided',
          decision: 'rejected',
          queueId,
          userId: queueRow.userId,
          actorUserId,
        },
        'CRP validation rejected',
      );

      return { ok: true as const };
    });
  } catch (err) {
    if (err instanceof TransitionRollback) {
      logger.warn(
        {
          event: 'crp_validation_decided',
          decision: 'reject_rolled_back',
          reason: err.transitionError,
          queueId,
          actorUserId,
        },
        'CRP rejection rolled back: profile transition failed',
      );
      return { ok: false, error: err.transitionError };
    }
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      {
        event: 'crp_validation_decided',
        decision: 'reject_unknown_error',
        errorName: name,
        queueId,
        actorUserId,
      },
      'CRP rejection failed with unknown error',
    );
    return { ok: false, error: 'unknown' };
  }
}

// Internal sentinel — see `./approve.ts` for the full rationale.
class TransitionRollback extends Error {
  constructor(public readonly transitionError: 'invalid_transition' | 'profile_not_found') {
    super(`transition rollback: ${transitionError}`);
    this.name = 'TransitionRollback';
  }
}
