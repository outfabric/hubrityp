/**
 * Public Route Handler for patient/partner video event logging.
 *
 * This endpoint is intentionally public (no Supabase auth required) — the
 * 64-char hex `token` in the request body is the authorization credential
 * (same pattern as /api/video/join). The middleware's `classifyPath()` returns
 * the default `'public'` for `/api/video/*` since it does not match any gated
 * prefix.
 *
 * Security controls:
 *  - In-memory per-token rate limiting (10/min) applied BEFORE any database
 *    work, preventing DoS amplification and log flooding.
 *  - POST validates body with Zod before any business logic.
 *  - Only structural event data is logged — NO PII or clinical content.
 *  - Ended/expired/not-found rooms return 404 (no insert).
 *  - Responses never expose internal IDs, patient data, or DB details.
 *  - `participant_role` is derived server-side from which token column matched
 *    (not from client input), preventing role spoofing.
 *
 * Runtime: Node.js (Drizzle/postgres-js requires Node).
 */
import { eq, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';
import { createRateLimiter } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const logBodySchema = z.object({
  token: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]+$/),
  event_type: z.enum([
    'patient_joined',
    'patient_left',
    'partner_joined',
    'partner_left',
    'connection_drop',
    'reconnected',
  ]),
  metadata: z
    .record(z.string().max(64), z.string().max(512))
    .refine((r) => Object.keys(r).length <= 20, { message: 'Too many metadata keys' })
    .optional(),
});

// ---------------------------------------------------------------------------
// Rate limiter (per token, 10 requests/min)
// ---------------------------------------------------------------------------

const checkRateLimit = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

// ---------------------------------------------------------------------------
// POST /api/video/log
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Validate with Zod
  const parsed = logBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { token, event_type, metadata } = parsed.data;

  // Rate limit per token BEFORE any DB work
  if (!checkRateLimit(token)) {
    return NextResponse.json(
      { error: 'TOO_MANY_REQUESTS' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    );
  }

  try {
    // Query video_rooms by patient_token or partner_token.
    //
    // Uses the app-level Drizzle client (`db`) which connects as the DB owner
    // and bypasses RLS. The patient/partner is not a Supabase user; the token
    // in the request body is the authorization credential. Service-role is
    // required to query video_rooms without RLS.
    const [room] = await db
      .select({
        id: videoRooms.id,
        patientToken: videoRooms.patientToken,
        partnerToken: videoRooms.partnerToken,
        userId: videoRooms.userId,
        sessionId: videoRooms.sessionId,
        status: videoRooms.status,
        expiresAt: videoRooms.expiresAt,
      })
      .from(videoRooms)
      .where(or(eq(videoRooms.patientToken, token), eq(videoRooms.partnerToken, token)))
      .limit(1);

    // Token not found
    if (!room) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const now = new Date();

    // Room ended/expired or past expiry — no insert
    if (room.status === 'ended' || room.status === 'expired' || now > room.expiresAt) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    // Derive participant_role from which token column matched (server-side,
    // not from client input — prevents role spoofing)
    const participantRole = room.patientToken === token ? 'patient' : 'partner';

    // INSERT into video_session_logs — append-only audit entry
    await db.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: event_type,
      participantRole,
      metadata: metadata ?? null,
    });

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    logger.error(
      { event: 'video_log_error', route: '/api/video/log' },
      'unexpected error in POST /api/video/log',
    );
    return NextResponse.json(
      { error: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
