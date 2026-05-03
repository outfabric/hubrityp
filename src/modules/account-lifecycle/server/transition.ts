import 'server-only';

import { eq } from 'drizzle-orm';

import { type AppDb, db } from '@/shared/db/client';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import {
  type AccountStatus,
  type TransitionEvent,
  type TransitionResult,
  transitionStatus,
} from '../lib/state-machine';

// Drizzle transaction client type — extracted from `db.transaction`'s
// callback signature so we don't have to import deep internal classes
// (`PostgresJsTransaction`, `PgTransaction`) directly. Both `AppDb` and the
// tx client expose `select` / `update` / `insert` etc. with identical types,
// so the union is what callers can pass through.
type AppTx = Parameters<Parameters<AppDb['transaction']>[0]>[0];
type DbOrTx = AppDb | AppTx;

// Apply a lifecycle transition to a psychologist's profile.
//
// Contract:
//   1. Loads the current `status` for `userId`.
//   2. Computes the next status via `transitionStatus`.
//   3. If valid, persists the new status in the same transaction. The
//      database trigger `psychologist_profiles_set_timestamps` advances
//      `status_changed_at` and `updated_at`; the AFTER-UPDATE trigger
//      `psychologist_profiles_mirror_status` mirrors the value into
//      `auth.users.raw_app_meta_data` for the JWT.
//   4. Returns the same `TransitionResult` shape as `transitionStatus`,
//      with an additional `profile_not_found` branch when the user has no
//      row yet (signup did not finish, or the row was hard-deleted).
//
// **The DB triggers — not this function — are the source of truth for the
// timestamp columns.** We deliberately do NOT set `statusChangedAt`/`updatedAt`
// in the UPDATE payload: if the trigger ever stops firing the test suite must
// catch it. The integration test asserts both columns advance after the
// helper runs.
//
// Note: this file is intentionally the only writer of `status` in `src/`
// (along with `state-machine.ts`, which only computes the next value). The
// `no-direct-status-writes.test.ts` unit test grep-asserts this invariant.
//
// The optional `tx` argument lets callers (e.g. the CRP approve/reject
// Server Actions) reuse an outer transaction. RN: with the postgres-js pool
// capped at `max: 1`, opening an inner `db.transaction` while an outer
// transaction holds a row lock on `psychologist_profiles` deadlocks — the
// inner call waits forever for a connection that the outer call will not
// release until the inner finishes. Reusing the caller's tx side-steps that
// entirely; the caller's outer ROLLBACK still nukes the writes performed
// here on a thrown error. When `tx` is omitted (the standalone path used by
// e.g. signup, email verification), we open our own transaction.
export async function applyTransition(
  userId: string,
  event: TransitionEvent,
  tx?: DbOrTx,
): Promise<TransitionResult> {
  if (tx === undefined) {
    return await db.transaction(async (innerTx) => applyTransition(userId, event, innerTx));
  }

  const rows = await tx
    .select({ status: psychologistProfiles.status })
    .from(psychologistProfiles)
    .where(eq(psychologistProfiles.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: false, error: 'profile_not_found' as const };
  }

  const result = transitionStatus(row.status as AccountStatus, event);
  if (!result.ok) {
    return result;
  }

  const next = result.status;
  await tx
    .update(psychologistProfiles)
    // The Drizzle `.set()` payload here intentionally targets the column
    // through the schema reference, NOT a JS object property assignment.
    // The grep guard in `no-direct-status-writes.test.ts` rejects direct
    // assignments to `.status` so any mutation outside this helper would
    // surface in CI.
    .set({ status: next })
    .where(eq(psychologistProfiles.userId, userId));

  return result;
}
