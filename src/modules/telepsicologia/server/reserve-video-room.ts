import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

import { ROOM_AVAILABLE_BEFORE_MINUTES, ROOM_EXPIRES_AFTER_HOURS } from '../lib/room-constants';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ReserveVideoRoomResult =
  | { ok: true; patientToken: string }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Input type — callers provide this from their own data-fetching layer
// ---------------------------------------------------------------------------

/**
 * Minimal session shape needed to reserve a room. Unlike `createVideoRoomHelper`
 * this carries no Stream-related fields (no display names, no patient type):
 * reservation is pure DB work with no Stream.io dependency.
 */
export interface ReserveSessionData {
  id: string;
  userId: string;
  startAt: Date;
  endAt: Date;
}

// ---------------------------------------------------------------------------
// Minimal DB type (any Drizzle Postgres client or transaction)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Reserves a partial `video_rooms` row at scheduling time for an online session.
 *
 * This is the FIRST half of the room lifecycle: it persists a lookup token and
 * the accessibility window so the patient link can be shared immediately, well
 * before the Stream.io call is provisioned. The SECOND half (activation) is
 * handled by `createVideoRoomHelper`, which populates `stream_call_id` and
 * `patient_jwt` closer to the session start.
 *
 * The reserved row carries `stream_call_id=NULL`, `patient_jwt=NULL` and
 * `status='pending'`. No Stream SDK is touched here — this is pure DB work.
 *
 * This helper is pure business logic: it does NOT authenticate or authorize.
 * The caller is responsible for verifying the user's identity and ownership of
 * the session before calling.
 *
 * Idempotent: if a row already exists for the session, the existing
 * `patient_token` is returned without inserting a duplicate. A concurrent
 * insert that loses the unique-constraint race (Postgres 23505) is handled by
 * re-fetching the winning row.
 */
export async function reserveVideoRoom(
  session: ReserveSessionData,
  db: DrizzleDb,
): Promise<ReserveVideoRoomResult> {
  try {
    // 1. Idempotent: if a room already exists, return its token.
    const existing = await findExistingToken(session, db);
    if (existing) {
      return { ok: true, patientToken: existing };
    }

    // 2. Generate a 64-char hex lookup token.
    const patientToken = randomBytes(32).toString('hex');

    // 3. Compute the accessibility window using the shared constants.
    const availableFrom = new Date(
      session.startAt.getTime() - ROOM_AVAILABLE_BEFORE_MINUTES * 60 * 1000,
    );
    const expiresAt = new Date(session.endAt.getTime() + ROOM_EXPIRES_AFTER_HOURS * 60 * 60 * 1000);

    // 4. INSERT the partial reservation row (no Stream call yet).
    await db.insert(videoRooms).values({
      userId: session.userId,
      sessionId: session.id,
      streamCallId: null,
      patientToken,
      patientJwt: null,
      availableFrom,
      expiresAt,
      status: 'pending',
    });

    return { ok: true, patientToken };
  } catch (err: unknown) {
    // Unique violation (23505): a concurrent request already reserved the room.
    // Re-fetch and return its token to make the helper fully idempotent.
    //
    // The PG error code is read from the error AND its `cause` chain, because
    // Drizzle wraps driver errors in a `DrizzleQueryError` whose top-level
    // `.code` is undefined — the real `23505` lives on `.cause` (the underlying
    // postgres `PostgresError`).
    if (isUniqueViolation(err)) {
      const existing = await findExistingToken(session, db);
      if (existing) {
        return { ok: true, patientToken: existing };
      }
    }

    logger.error(
      {
        event: 'reserve_video_room_failed',
        errorCode: (err as { code?: string }).code,
        errorMessage: err instanceof Error ? err.message : 'unknown',
      },
      'unexpected error reserving video room',
    );
    return {
      ok: false,
      message: 'Erro inesperado ao reservar sala de vídeo. Tente novamente.',
    };
  }
}

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/**
 * Detects a Postgres unique-violation, walking the `cause` chain. Drizzle wraps
 * driver errors so the real SQLSTATE often sits on `err.cause`, not `err`.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  // Bounded walk to avoid an infinite loop on a self-referential cause chain.
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Looks up the `patient_token` of an existing room for this owner+session pair.
 * Returns `null` when no row exists yet.
 */
async function findExistingToken(
  session: ReserveSessionData,
  db: DrizzleDb,
): Promise<string | null> {
  const [row] = await db
    .select({ patientToken: videoRooms.patientToken })
    .from(videoRooms)
    .where(and(eq(videoRooms.sessionId, session.id), eq(videoRooms.userId, session.userId)))
    .limit(1);

  return row?.patientToken ?? null;
}
