import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { rateLimits } from '@/shared/db/schema/rate-limits/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Direct SQL UPSERT mirroring `enforceRateLimit` logic — avoids importing
 *  `server-only` in the test environment. */
async function enforceRateLimitDirect(
  db: Parameters<Parameters<typeof runAsService>[0]>[0],
  params: { key: string; max: number; windowSeconds: number },
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const { key, max, windowSeconds } = params;

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

  const row = rows[0] as { count: number; window_start: string | Date };
  const windowStart = new Date(row.window_start);
  const resetAt = new Date(windowStart.getTime() + windowSeconds * 1_000);
  const allowed = row.count <= max;
  const remaining = Math.max(0, max - row.count);

  return { allowed, remaining, resetAt };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(rateLimits);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Postgres rate limiter', () => {
  it('(a) under the limit, returns allowed:true', async () => {
    const key = `test:${randomUUID()}`;

    const result = await runAsService(async (db) => {
      return enforceRateLimitDirect(db, { key, max: 3, windowSeconds: 60 });
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.resetAt).toBeInstanceOf(Date);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('(b) at the limit, returns allowed:false', async () => {
    const key = `test:${randomUUID()}`;

    // Exhaust the limit (max=2 → 2 allowed calls, 3rd blocked).
    const results = await runAsService(async (db) => {
      const r1 = await enforceRateLimitDirect(db, { key, max: 2, windowSeconds: 60 });
      const r2 = await enforceRateLimitDirect(db, { key, max: 2, windowSeconds: 60 });
      const r3 = await enforceRateLimitDirect(db, { key, max: 2, windowSeconds: 60 });
      return [r1, r2, r3] as const;
    });

    expect(results[0].allowed).toBe(true);
    expect(results[0].remaining).toBe(1);

    expect(results[1].allowed).toBe(true);
    expect(results[1].remaining).toBe(0);

    expect(results[2].allowed).toBe(false);
    expect(results[2].remaining).toBe(0);
  });

  it('(c) after the window rolls over, allows again', async () => {
    const key = `test:${randomUUID()}`;

    // Seed a row with window_start far in the past so the next call resets.
    await runAsService(async (db) => {
      await db.insert(rateLimits).values({
        key,
        windowStart: new Date(Date.now() - 120_000), // 2 minutes ago
        count: 99, // way over any limit
      });
    });

    // The window is 60s, and the stored window_start is 120s ago → expired.
    const result = await runAsService(async (db) => {
      return enforceRateLimitDirect(db, { key, max: 5, windowSeconds: 60 });
    });

    expect(result.allowed).toBe(true);
    // Count reset to 1, max is 5, so remaining = 4.
    expect(result.remaining).toBe(4);
  });

  it('(d) concurrent requests do not under-count', async () => {
    const key = `test:${randomUUID()}`;
    const max = 5;
    const concurrency = 10;

    // Fire 10 concurrent UPSERTs against the same key with max=5.
    // Exactly 5 should be allowed, 5 should be denied.
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        runAsService(async (db) => {
          return enforceRateLimitDirect(db, { key, max, windowSeconds: 60 });
        }),
      ),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(max);
    expect(deniedCount).toBe(concurrency - max);

    // Verify the final count in the database equals `concurrency`.
    const rows = await runAsService(async (db) => {
      return db.select().from(rateLimits);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(concurrency);
  });
});
