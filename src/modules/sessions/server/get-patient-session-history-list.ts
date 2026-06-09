import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

import {
  decodeSessionHistoryCursor,
  encodeSessionHistoryCursor,
} from '../lib/session-history-cursor';
import { sessionHistoryInputSchema, type SessionHistoryItem } from '../lib/session-history-schema';

import {
  mapSessionRow,
  sessionHistoryColumns,
  type SessionHistoryRow,
} from './session-history-row';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Discriminated result for the paginated patient session-history list.
 *
 * `nextCursor` is `null` when the page is the last one (no look-ahead row).
 */
export type SessionHistoryListResult =
  | { ok: true; sessions: SessionHistoryItem[]; nextCursor: string | null }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns one page of the historical session list for a patient of the
 * authenticated psychologist (D4, RF-13.03, RF-13.04, RF-13.05, RF-13.11,
 * RF-13.12).
 *
 * Ordering & pagination: rows are ordered `start_at DESC, id DESC` and fetched
 * with the `limit + 1` look-ahead pattern. If the extra row exists, it is
 * dropped from the page and its `(start_at, id)` predecessor (the last *kept*
 * row) becomes the opaque `nextCursor` for keyset pagination — stable under
 * concurrent inserts, unlike OFFSET.
 *
 * Future-session exclusion: the nearest upcoming session is rendered separately
 * (see `getNearestFutureSession`), so its id is excluded here to avoid showing
 * it twice. The caller passes `excludeSessionId`.
 *
 * Security (D7 — owner-scope everything):
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()`).
 *   2. Input is Zod-validated; `patient_id` is a filter, never a trust boundary.
 *      The query is scoped `user_id = session.uid AND patient_id = :pid`. `db`
 *      bypasses RLS, so this explicit owner predicate is the defense-in-depth
 *      layer guaranteeing no cross-tenant read (RN-13.04).
 *
 * Visibility (RN-13.01, RN-13.02): soft-deleted and blocking rows are excluded.
 *
 * Couple-safe projection (LGPD-13.03, RN-13.06): the shared projection exposes
 * only the boolean presence of `patient_ids` — never the partner id or name.
 */
export async function getPatientSessionHistoryList(
  supabase: SupabaseClient,
  rawInput: unknown,
  excludeSessionId: string | null,
): Promise<SessionHistoryListResult> {
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
  const { patientId, cursor: rawCursor, status, limit } = parsed.data;

  try {
    const predicates: SQL[] = [
      eq(sessions.userId, userId),
      eq(sessions.patientId, patientId),
      isNull(sessions.deletedAt),
      eq(sessions.isBlocking, false),
    ];

    // Optional terminal-status filter (RF-13.03).
    if (status !== undefined) {
      predicates.push(eq(sessions.status, status));
    }

    // Exclude the nearest-future session so it is not duplicated in the list.
    if (excludeSessionId !== null) {
      predicates.push(ne(sessions.id, excludeSessionId));
    }

    // Keyset cursor: a malformed/tampered cursor decodes to null → first page.
    const cursor = rawCursor === undefined ? null : decodeSessionHistoryCursor(rawCursor);
    if (cursor !== null) {
      // (start_at, id) < (cursorStartAt, cursorId) under DESC ordering.
      const cursorStartAt = sql`${cursor.startAt}::timestamptz`;
      predicates.push(
        or(
          lt(sessions.startAt, cursorStartAt),
          and(eq(sessions.startAt, cursorStartAt), lt(sessions.id, cursor.id)),
        )!,
      );
    }

    // `limit + 1` look-ahead: the extra row tells us whether a next page exists.
    const rows = (await db
      .select(sessionHistoryColumns)
      .from(sessions)
      .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
      .leftJoin(locations, eq(locations.id, sessions.locationId))
      .where(and(...predicates))
      .orderBy(desc(sessions.startAt), desc(sessions.id))
      .limit(limit + 1)) as SessionHistoryRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(mapSessionRow);

    const last = items.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? encodeSessionHistoryCursor({ startAt: last.startAt, id: last.id })
        : null;

    return { ok: true, sessions: items, nextCursor };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_patient_session_history_list_failed', errorCode: pgError.code },
      'unexpected error reading patient session history list',
    );
    return { ok: false, code: 'ERROR' };
  }
}
