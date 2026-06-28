/**
 * Public Route Handler for patient/partner departure from the waiting room.
 *
 * Triggered by a `navigator.sendBeacon` call from the waiting-room view when
 * the page is hidden/unloaded (`pagehide`). Its sole job is to clear the
 * liveness heartbeat (`patient_last_seen_at`) so the psychologist's UI can
 * reflect that the patient stepped away, WITHOUT erasing the first-arrival
 * audit marker (`patient_waiting_at`).
 *
 * This endpoint is intentionally public (no Supabase auth required) — the
 * 64-char hex `token` in the request body is the authorization credential
 * (256 bits of entropy), mirroring /api/video/join and /api/video/log.
 * `sendBeacon` cannot set custom auth headers, so the token in the body is the
 * only available credential. The middleware's `classifyPath()` returns the
 * default `'public'` for `/api/video/*`.
 *
 * Security controls:
 *  - In-memory per-IP rate limiting (10/min) applied BEFORE any database work,
 *    preventing DoS amplification and token brute-forcing.
 *  - POST validates body with Zod before any business logic (same `{ token }`
 *    shape as join: length 64, `^[a-f0-9]+$`).
 *  - The UPDATE is guarded so it is idempotent and never disturbs an admitted
 *    room (see below).
 *  - Responses are an opaque empty 204 — no IDs, tokens, JWTs, PII, DB details,
 *    or even an existence oracle (a well-formed-but-unknown token gets the same
 *    response as a successful clear). `sendBeacon` ignores the response anyway.
 *  - Errors are logged without PII.
 *
 * Runtime: Node.js (Drizzle/postgres-js requires Node).
 */
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';
import { createRateLimiter, extractClientIp } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Input validation — same shape as /api/video/join.
// ---------------------------------------------------------------------------

const departBodySchema = z.object({
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

/** Opaque empty success/no-op response — exposes no existence oracle. */
function emptyOk(): NextResponse {
  return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
}

// ---------------------------------------------------------------------------
// POST /api/video/depart
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractClientIp(request);

  // Rate limit BEFORE any DB work.
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'TOO_MANY_REQUESTS' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    );
  }

  // Parse body. `sendBeacon` sends the JSON Blob as the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Validate with Zod.
  const parsed = departBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { token } = parsed.data;

  try {
    // Clear the liveness heartbeat only.
    //
    // Uses the app-level Drizzle client (`db`) which connects as the DB owner
    // and bypasses RLS. The patient/partner is not a Supabase user; the token
    // in the request body is the authorization credential.
    //
    // Guards (mirror design.md Decision 6):
    //  - status = 'pending'          → a beacon racing an admission must NOT
    //                                  clear liveness on an already-active room.
    //  - patient_last_seen_at IS NOT → makes duplicate beacons idempotent
    //    NULL                          (a second beacon updates zero rows).
    //
    // `patient_waiting_at` is intentionally NOT touched — it is the immutable
    // first-arrival audit marker.
    await db
      .update(videoRooms)
      .set({ patientLastSeenAt: null })
      .where(
        and(
          or(eq(videoRooms.patientToken, token), eq(videoRooms.partnerToken, token)),
          eq(videoRooms.status, 'pending'),
          isNotNull(videoRooms.patientLastSeenAt),
        ),
      );

    // Opaque response regardless of how many rows matched (0 or 1): never
    // reveal whether the token exists or whether it cleared anything.
    return emptyOk();
  } catch {
    logger.error(
      { event: 'video_depart_error', route: '/api/video/depart' },
      'unexpected error in POST /api/video/depart',
    );
    return NextResponse.json(
      { error: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
