/**
 * In-memory sliding-window rate limiter.
 *
 * Each call to `createRateLimiter` returns an independent bucket map. This
 * allows different Route Handlers to maintain separate rate-limit state while
 * sharing the same implementation.
 *
 * The limiter is intentionally simple (in-process Map) because it runs on
 * Vercel Serverless Functions where per-instance state resets across cold
 * starts. For a distributed limiter, use a Redis-backed approach.
 */
import { type NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// Lazy cleanup threshold: purge expired entries when the map exceeds this.
const CLEANUP_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a standalone rate limiter with its own in-memory bucket.
 *
 * @returns A `checkRateLimit(key)` function. Returns `true` when the request
 *          is allowed, `false` when the caller should be throttled.
 */
export function createRateLimiter(config: RateLimitConfig): (key: string) => boolean {
  const bucket = new Map<string, RateLimitEntry>();

  return function checkRateLimit(key: string): boolean {
    const now = Date.now();

    if (bucket.size > CLEANUP_THRESHOLD) {
      for (const [k, entry] of bucket) {
        if (entry.resetAt <= now) {
          bucket.delete(k);
        }
      }
    }

    const existing = bucket.get(key);

    if (!existing || existing.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + config.windowMs });
      return true;
    }

    existing.count += 1;
    return existing.count <= config.maxRequests;
  };
}

// ---------------------------------------------------------------------------
// IP extraction helper
// ---------------------------------------------------------------------------

/**
 * Extracts the client IP from the incoming request headers, preferring
 * `x-forwarded-for` (first entry) then `x-real-ip`, falling back to
 * `'unknown'`.
 */
export function extractClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}
