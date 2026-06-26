/**
 * Public Route Handler for patient/partner video room join.
 *
 * This endpoint is intentionally public (no Supabase auth required) — the
 * 64-char hex `token` in the request body is the authorization credential
 * (256 bits of entropy). The middleware's `classifyPath()` returns the
 * default `'public'` for `/api/video/*` since it does not match any gated
 * prefix.
 *
 * Security controls:
 *  - In-memory per-IP rate limiting (10/min) applied BEFORE any database work,
 *    preventing DoS amplification and brute-force token guessing.
 *  - POST validates body with Zod before any business logic.
 *  - Stream JWT is ONLY returned when the room status is 'active' — never
 *    before the psychologist admits the patient. This prevents pre-admission
 *    call join.
 *  - Responses never expose internal IDs (room.id, session.id, user.id),
 *    patient data, clinical content, or DB details.
 *  - Not-found tokens return 404 with a generic error code.
 *  - Ended/expired rooms return 410 to signal the session is over.
 *
 * Runtime: Node.js (Drizzle/postgres-js requires Node).
 */
import { eq, or, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { clientEnv } from '@/shared/env/client';
import { logger } from '@/shared/lib/logger';
import { createRateLimiter, extractClientIp } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const joinBodySchema = z.object({
  token: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]+$/),
});

// ---------------------------------------------------------------------------
// Rate limiter (per IP, 10 requests/min)
// ---------------------------------------------------------------------------

const checkRateLimit = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

// ---------------------------------------------------------------------------
// POST /api/video/join
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractClientIp(request);

  // Rate limit BEFORE any DB work
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'TOO_MANY_REQUESTS' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    );
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Validate with Zod
  const parsed = joinBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { token } = parsed.data;

  try {
    // Query video_rooms by patient_token or partner_token.
    //
    // Uses the app-level Drizzle client (`db`) which connects as the DB owner
    // and bypasses RLS. Patient is not a Supabase user; the token in the
    // request body is the authorization credential. Service-role is required
    // to query video_rooms without RLS.
    const [room] = await db
      .select({
        patientToken: videoRooms.patientToken,
        partnerToken: videoRooms.partnerToken,
        patientJwt: videoRooms.patientJwt,
        partnerJwt: videoRooms.partnerJwt,
        streamCallId: videoRooms.streamCallId,
        availableFrom: videoRooms.availableFrom,
        expiresAt: videoRooms.expiresAt,
        status: videoRooms.status,
        userId: videoRooms.userId,
        sessionId: videoRooms.sessionId,
      })
      .from(videoRooms)
      .where(or(eq(videoRooms.patientToken, token), eq(videoRooms.partnerToken, token)))
      .limit(1);

    // Token not found
    if (!room) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    // Determine which token matched to pick the correct JWT
    const isPatient = room.patientToken === token;
    const streamToken = isPatient ? room.patientJwt : room.partnerJwt;

    // Load psychologist profile (name, photo) via userId
    // TODO(photo): add avatarUrl to SELECT once profiles.avatarUrl exists
    const [profile] = await db
      .select({
        fullName: profiles.fullName,
      })
      .from(profiles)
      .where(eq(profiles.userId, room.userId))
      .limit(1);

    const psychologistName = profile?.fullName ?? null;
    // No photo/avatar column exists in profiles yet — return null
    const psychologistPhotoUrl: string | null = null;

    // Reserved-but-not-activated room: the room row exists (created at reserve
    // time) but the Stream call has not been minted yet (`streamCallId IS NULL`).
    // The patient sees the same "too early" view as a pre-window join — we
    // resolve the real session start time from the `sessions` table (the room's
    // `availableFrom` is the 10-minute-early window, not the session start). No
    // streamToken/apiKey/callId is returned in this state.
    if (room.streamCallId === null) {
      const [session] = await db
        .select({ startAt: sessions.startAt })
        .from(sessions)
        .where(eq(sessions.id, room.sessionId))
        .limit(1);

      return NextResponse.json(
        {
          status: 'too_early',
          sessionStartAt: session?.startAt.toISOString() ?? room.availableFrom.toISOString(),
          psychologistName,
          psychologistPhotoUrl,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    const now = new Date();

    // Status determination — order matters:
    // 1. Check ended/expired status OR past expiresAt -> 410
    //    Include psychologistName so the client can show a personalised ended
    //    message ("Fale com [Psicólogo] se precisar reagendar"). The token
    //    already authorises knowledge of the patient's own therapist; no
    //    internal IDs or patient data are exposed.
    if (room.status === 'ended' || room.status === 'expired' || now > room.expiresAt) {
      return NextResponse.json(
        { error: 'SESSION_ENDED', psychologistName },
        { status: 410, headers: NO_STORE_HEADERS },
      );
    }

    // 2. Too early — before the available window
    if (now < room.availableFrom) {
      return NextResponse.json(
        {
          status: 'too_early',
          sessionStartAt: room.availableFrom.toISOString(),
          psychologistName,
          psychologistPhotoUrl,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // 3. Active — psychologist has started the session
    if (room.status === 'active') {
      // Register the patient/partner user in Stream BEFORE handing out the
      // call JWT. Client-side `call.join()` fails if the joining user is not
      // present in Stream's user DB; the join handler is the last server-side
      // touchpoint before the patient enters the call, so we upsert here in
      // addition to room creation (room creation can predate Stream user
      // provisioning failures, e.g. transient errors).
      //
      // The synthetic user ID is reconstructed from the session's patient (the
      // same scheme used when minting the JWT: `patient-<patientId>` /
      // `partner-<patientId>`), avoiding JWT parsing.
      const [patient] = await db
        .select({
          patientId: patients.id,
          fullName: patients.fullName,
        })
        .from(sessions)
        .innerJoin(patients, eq(sessions.patientId, patients.id))
        .where(eq(sessions.id, room.sessionId))
        .limit(1);

      // Fall back to the session ID when no patient is linked, mirroring the
      // JWT minting scheme (`patient-${session.patientId ?? session.id}`).
      const syntheticBaseId = patient?.patientId ?? room.sessionId;
      const syntheticUserId = isPatient
        ? `patient-${syntheticBaseId}`
        : `partner-${syntheticBaseId}`;
      const displayName = patient?.fullName ?? syntheticUserId;

      try {
        const streamClient = getStreamClient();
        await streamClient.upsertUsers([{ id: syntheticUserId, name: displayName }]);
      } catch {
        logger.error(
          { event: 'video_join_upsert_error', route: '/api/video/join' },
          'failed to upsert Stream user in POST /api/video/join',
        );
        return NextResponse.json(
          { error: 'INTERNAL_ERROR' },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          status: 'active',
          streamToken,
          apiKey: clientEnv.NEXT_PUBLIC_STREAM_API_KEY,
          callId: room.streamCallId,
          psychologistName,
          psychologistPhotoUrl,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // 4. Waiting — within time window, room is pending (psychologist hasn't
    //    admitted yet). This is the only branch that records presence: the
    //    too_early/active/ended paths above all return before this point, so
    //    they never touch either timestamp.
    //
    // A single UPDATE advances the liveness heartbeat on EVERY poll and stamps
    // the first-arrival anchor exactly once, using one server `now()` for a
    // consistent clock:
    //  - patient_last_seen_at = now()            → always advances (heartbeat)
    //  - patient_waiting_at = COALESCE(it, now())→ set once, immutable after
    //
    // The RETURNING comparison `(patient_waiting_at = patient_last_seen_at)` is
    // true ONLY on the first poll, when both columns were just set to the same
    // now(). On every later poll patient_waiting_at keeps its older value while
    // patient_last_seen_at moves forward, so the comparison is false — even on a
    // re-arrival after a departure (heartbeat reset to NULL, waiting_at still
    // set), which re-stamps liveness without re-logging arrival.
    const [arrival] = await db.execute<{ is_first_arrival: boolean }>(
      sql`
        UPDATE ${videoRooms}
        SET patient_last_seen_at = now(),
            patient_waiting_at = COALESCE(${videoRooms.patientWaitingAt}, now())
        WHERE ${videoRooms.patientToken} = ${token}
           OR ${videoRooms.partnerToken} = ${token}
        RETURNING (${videoRooms.patientWaitingAt} = ${videoRooms.patientLastSeenAt})
          AS is_first_arrival
      `,
    );

    if (arrival?.is_first_arrival) {
      // First arrival only: append exactly one append-only audit row,
      // attributed to the role of the token that matched.
      await db.insert(videoSessionLogs).values({
        sessionId: room.sessionId,
        userId: room.userId,
        eventType: 'patient_arrived',
        participantRole: isPatient ? 'patient' : 'partner',
      });
    }

    return NextResponse.json(
      {
        status: 'waiting',
        psychologistName,
        psychologistPhotoUrl,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    logger.error(
      { event: 'video_join_error', route: '/api/video/join' },
      'unexpected error in POST /api/video/join',
    );
    return NextResponse.json(
      { error: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
