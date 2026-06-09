import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/shared/db/client';
import { auditLog } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

import {
  sessionHistoryInputSchema,
  type SessionHistoryResult,
} from '../lib/session-history-schema';

import { getNearestFutureSession } from './get-nearest-future-session';
import { getPatientSessionHistoryList } from './get-patient-session-history-list';
import { getPatientSessionSummary } from './get-patient-session-summary';

// ---------------------------------------------------------------------------
// Audit (LGPD-13.01)
// ---------------------------------------------------------------------------

/**
 * Writes the single `patient.session_history.read` audit entry for an initial
 * open (cursor-absent) read.
 *
 * **Why direct Drizzle (`db`) and not the RLS-scoped client:** the `audit_log`
 * table has NO authenticated INSERT policy by design (see medical-records
 * `policies.ts`) — this prevents a user from forging or poisoning their own
 * audit trail. Only server-side code, via the direct `db` pool (which connects
 * as the DB owner and bypasses RLS), may append an entry. The `userId` is the
 * verified session id passed in by the caller, never a client-supplied value.
 *
 * Best-effort: a write failure is logged (without PII) and swallowed so the
 * read itself is never blocked by an audit hiccup. The row carries only
 * identifiers (`user_id`, `resource_id`) — no patient name, no clinical text.
 */
async function writeReadAuditEntry(userId: string, patientId: string): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId,
      action: 'patient.session_history.read',
      resourceType: 'patient',
      resourceId: patientId,
    });
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'patient_session_history_audit_failed', errorCode: pgError.code },
      'failed to write patient session-history read audit entry',
    );
    // Fire-and-forget: never fail the read because the audit write failed.
  }
}

// ---------------------------------------------------------------------------
// Read entrypoint (D2)
// ---------------------------------------------------------------------------

/**
 * Single read entrypoint for the patient session-history tab (D2, RF-13.02,
 * D7).
 *
 * Cursor-conditional payload:
 *   - **Initial open** (`cursor` absent): runs the summary, the nearest-future
 *     session, and the first list page, returns all three plus `nextCursor`,
 *     and writes ONE `audit_log` read entry (LGPD-13.01).
 *   - **Load-more** (`cursor` present): runs only the list page and returns
 *     `{ sessions, nextCursor }`. No summary recompute, no future-session read,
 *     and NO audit entry — load-more is a continuation of the same open, not a
 *     new access event.
 *
 * Security (D7 — owner-scope everything):
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()` for an
 *      authorization decision). An unauthenticated caller is rejected here
 *      before any DB work.
 *   2. Input is Zod-validated at the boundary; `patientId` is a *filter*, never
 *      a trust boundary. Every underlying query is owner-scoped on the verified
 *      `user.id`, so a tampered `patientId` can only ever return the caller's
 *      own rows (or nothing).
 *
 * The returned shape is the sanitized discriminated union from the schema —
 * counts, ids, and ISO timestamps only, never a patient name or clinical text —
 * so it is safe to surface as-is. Internal errors are logged without PII and
 * collapsed to `{ ok: false, code: 'ERROR' }`.
 */
export async function getPatientSessionHistoryImpl(
  supabase: SupabaseClient,
  rawInput: unknown,
): Promise<SessionHistoryResult> {
  // 1. Authenticate (revalidates the JWT with GoTrue — getSession would not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate the caller-supplied input at the boundary.
  const parsed = sessionHistoryInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const userId = user.id;
  const { patientId, cursor } = parsed.data;
  const isInitialOpen = cursor === undefined;

  try {
    // ---- Load-more (cursor present): list page only, no audit -------------
    if (!isInitialOpen) {
      const listResult = await getPatientSessionHistoryList(supabase, parsed.data, null);
      if (!listResult.ok) {
        return listResult;
      }
      return {
        ok: true,
        sessions: listResult.sessions,
        nextCursor: listResult.nextCursor,
      };
    }

    // ---- Initial open (cursor absent): summary + future + first page ------
    //
    // The future session is fetched first because its id is excluded from the
    // list page so the nearest upcoming session is never rendered twice.
    const [summaryResult, futureResult] = await Promise.all([
      getPatientSessionSummary(supabase, patientId),
      getNearestFutureSession(supabase, patientId),
    ]);

    if (!summaryResult.ok) {
      return summaryResult;
    }
    if (!futureResult.ok) {
      return futureResult;
    }

    const excludeSessionId = futureResult.session?.id ?? null;
    const listResult = await getPatientSessionHistoryList(supabase, parsed.data, excludeSessionId);
    if (!listResult.ok) {
      return listResult;
    }

    // 3. Best-effort audit on initial open only (LGPD-13.01). Awaited so the
    //    entry is durable before the read returns, but its failure never fails
    //    the read (see `writeReadAuditEntry`).
    await writeReadAuditEntry(userId, patientId);

    return {
      ok: true,
      summary: summaryResult.summary,
      ...(futureResult.session !== null ? { futureSession: futureResult.session } : {}),
      sessions: listResult.sessions,
      nextCursor: listResult.nextCursor,
    };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_patient_session_history_failed', errorCode: pgError.code },
      'unexpected error reading patient session history',
    );
    return { ok: false, code: 'ERROR' };
  }
}
