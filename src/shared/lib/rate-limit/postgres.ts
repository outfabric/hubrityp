import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  /** Whether the request is allowed (under the limit). */
  allowed: boolean;
  /** How many requests remain in the current window (0 when blocked). */
  remaining: number;
  /** When the current window resets — the caller can surface this to the user. */
  resetAt: Date;
}

interface EnforceRateLimitParams {
  /** Unique key identifying the rate-limit bucket (e.g. "upload:<userId>"). */
  key: string;
  /** Maximum number of requests allowed per window. */
  max: number;
  /** Window duration in seconds. */
  windowSeconds: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Postgres-backed sliding-window rate limiter.
 *
 * Uses an atomic INSERT ... ON CONFLICT DO UPDATE to maintain a counter per
 * key. If the current window has not expired, the count is incremented; if
 * the window has elapsed, the counter resets to 1.
 *
 * This approach is safe for multi-instance deployments (Vercel) because all
 * instances share the same Postgres database. The UPSERT is atomic — no
 * external locking is needed, and concurrent requests will not under-count.
 *
 * The function returns the result synchronously after the UPSERT, so the
 * caller can decide whether to proceed or reject the request.
 */
export async function enforceRateLimit({
  key,
  max,
  windowSeconds,
}: EnforceRateLimitParams): Promise<RateLimitResult> {
  // The UPSERT atomically:
  //   - INSERTs a new row with count=1 and window_start=now() when the key
  //     is absent, OR
  //   - If the existing window has expired (now() >= window_start + interval),
  //     resets count to 1 and window_start to now(), OR
  //   - If the window is still active, increments count by 1.
  //
  // The RETURNING clause gives us the post-UPSERT state so we can compute
  // `allowed` and `remaining` without a second round-trip.
  const rows = await db.execute(
    sql`INSERT INTO rate_limits (key, window_start, count)
        VALUES (${key}, now(), 1)
        ON CONFLICT (key) DO UPDATE
        SET
          count = CASE
            WHEN rate_limits.window_start + (${windowSeconds}::int * interval '1 second') <= now()
            THEN 1
            ELSE rate_limits.count + 1
          END,
          window_start = CASE
            WHEN rate_limits.window_start + (${windowSeconds}::int * interval '1 second') <= now()
            THEN now()
            ELSE rate_limits.window_start
          END
        RETURNING count, window_start`,
  );

  const row = rows[0] as { count: number; window_start: string | Date } | undefined;

  if (!row) {
    // Defensive: should never happen — UPSERT always returns 1 row.
    // Fail open would be dangerous; fail closed is the safe default.
    return { allowed: false, remaining: 0, resetAt: new Date() };
  }

  const windowStart = new Date(row.window_start);
  const resetAt = new Date(windowStart.getTime() + windowSeconds * 1_000);
  const allowed = row.count <= max;
  const remaining = Math.max(0, max - row.count);

  return { allowed, remaining, resetAt };
}
