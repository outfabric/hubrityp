/**
 * Public Route Handler for patient-facing scale applications.
 *
 * This endpoint is intentionally public (no auth required) — the
 * `remote_token` in the URL is the authorization credential (256 bits of
 * entropy, 64 hex chars). The middleware classifies `/api/scales/*` as
 * public via the `/escala` prefix rule (this API lives behind the same
 * gate as the patient-facing `/escala/[token]` page).
 *
 * Security controls:
 *  - In-memory per-IP rate limiting (20/min GET, 5/min POST) applied BEFORE
 *    any database work, preventing DoS amplification.
 *  - GET returns only scale questions + status flags (no user_id, patient_id,
 *    names, or clinical content).
 *  - Not-found and expired tokens return an identical shape to prevent token
 *    enumeration attacks.
 *  - POST validates body with Zod before any business logic.
 *  - Errors never leak DB details, table names, or internal IDs.
 *
 * Runtime: Node.js (service-role queries use postgres-js which requires Node).
 */
import { type NextRequest, NextResponse } from 'next/server';

import {
  getScaleApplicationByToken,
  scaleByKey,
  submitResponsesByTokenSchema,
  submitScaleResponsesByToken,
} from '@/modules/medical-records';
import { logger } from '@/shared/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// In-memory rate limiter (design.md decision #5)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Separate buckets for GET and POST to allow different thresholds.
const rateLimitBuckets = {
  GET: new Map<string, RateLimitEntry>(),
  POST: new Map<string, RateLimitEntry>(),
} as const;

const RATE_LIMITS = {
  GET: { maxRequests: 20, windowMs: 60_000 },
  POST: { maxRequests: 5, windowMs: 60_000 },
} as const;

// Lazy cleanup threshold: purge expired entries when the map exceeds this.
const CLEANUP_THRESHOLD = 1000;

function extractClientIp(request: NextRequest): string {
  // x-forwarded-for may contain a comma-separated list; take the first value.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Fallback: unknown (should not happen behind a reverse proxy)
  return 'unknown';
}

function checkRateLimit(method: 'GET' | 'POST', ip: string): boolean {
  const bucket = rateLimitBuckets[method];
  const limit = RATE_LIMITS[method];
  const now = Date.now();

  // Lazy cleanup: when the map grows too large, purge expired entries
  if (bucket.size > CLEANUP_THRESHOLD) {
    for (const [key, entry] of bucket) {
      if (entry.resetAt <= now) {
        bucket.delete(key);
      }
    }
  }

  const existing = bucket.get(ip);

  if (!existing || existing.resetAt <= now) {
    // New window
    bucket.set(ip, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }

  existing.count += 1;
  if (existing.count > limit.maxRequests) {
    return false;
  }

  return true;
}

function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { ok: false, code: 'TOO_MANY_REQUESTS' },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

// ---------------------------------------------------------------------------
// GET /api/scales/[token]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const ip = extractClientIp(request);

  // Rate limit BEFORE any DB work
  if (!checkRateLimit('GET', ip)) {
    return tooManyRequests();
  }

  const { token } = await params;

  try {
    const result = await getScaleApplicationByToken(token);

    // Not found — return identical shape to expired (prevents enumeration)
    if (!result.ok) {
      return NextResponse.json(
        { isExpired: true, isCompleted: false },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // Expired — return without questions
    if (result.isExpired) {
      return NextResponse.json(
        { isExpired: true, isCompleted: false },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // Already completed
    if (result.isCompleted) {
      return NextResponse.json(
        { isCompleted: true, isExpired: false },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // Valid, active application — include questions from the scale library
    const scaleDef = scaleByKey(result.scaleKey);
    const questions = scaleDef?.questions ?? [];

    return NextResponse.json(
      {
        scaleKey: result.scaleKey,
        questions,
        isExpired: false,
        isCompleted: false,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    logger.error(
      { event: 'scale_route_get_error', route: '/api/scales/[token]' },
      'unexpected error in GET /api/scales/[token]',
    );
    return NextResponse.json(
      { ok: false, code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/scales/[token]
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const ip = extractClientIp(request);

  // Rate limit BEFORE any DB work
  if (!checkRateLimit('POST', ip)) {
    return tooManyRequests();
  }

  const { token } = await params;

  // Parse and validate body with Zod
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: 'INVALID_BODY' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // The schema validates both token and responses; token comes from the URL
  const parsed = submitResponsesByTokenSchema.safeParse({
    token,
    responses: (body as Record<string, unknown>)?.responses,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await submitScaleResponsesByToken(parsed.data.token, parsed.data.responses, ip);

    if (result.ok) {
      return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // Map error codes to HTTP statuses — never leak internal details
    const statusMap: Record<string, number> = {
      INVALID_TOKEN: 404,
      EXPIRED: 400,
      ALREADY_COMPLETED: 409,
      INVALID_RESPONSES: 400,
    };

    const status = statusMap[result.code] ?? 400;
    return NextResponse.json(
      { ok: false, code: result.code },
      { status, headers: NO_STORE_HEADERS },
    );
  } catch {
    logger.error(
      { event: 'scale_route_post_error', route: '/api/scales/[token]' },
      'unexpected error in POST /api/scales/[token]',
    );
    return NextResponse.json(
      { ok: false, code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
