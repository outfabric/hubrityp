// Shared Playwright fixture that exposes a `postgres.js` connection to the
// Testcontainers database. Test files that need direct DB access for
// setup/teardown import `{ test, expect }` from this module instead of
// `@playwright/test`.
//
// The fixture reads `databaseUrl` from `seed-state.json` (written by
// `start-server.ts` during the webServer boot phase) and opens a single
// connection per worker. Workers are process-isolated in Playwright, so
// each worker gets its own connection — no cross-worker contention.
//
// Usage:
//   import { test, expect } from '../setup/db-fixture';
//
//   test.beforeEach(async ({ db }) => {
//     await db.resetSession(SEED_SESSIONS.cancellable.id, {
//       status: 'scheduled',
//     });
//   });

import { test as base, expect } from '@playwright/test';
import postgres from 'postgres';

import { readSeedState, type SeedState } from './seed-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Override fields accepted by `resetSession`. Every field is optional —
 * unset fields receive safe defaults that clear mutation side-effects
 * (cancellation, confirmation, soft-delete).
 */
export type SessionResetOverrides = {
  status?: string;
  confirmedAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  cancelledBy?: string | null;
  cancellationNotice?: string | null;
  chargeCancellation?: boolean;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
};

/**
 * The `db` fixture exposed to test files. Provides a raw `postgres.js`
 * SQL tagged-template function and higher-level helpers for common reset
 * operations.
 */
export type DbFixture = {
  /** Raw postgres.js SQL tagged-template function for ad-hoc queries. */
  sql: postgres.Sql;

  /**
   * Reset a session row to its original seeded values.
   *
   * Runs an UPDATE that resets status, all cancellation fields,
   * `confirmed_at`, `updated_at`, and `deleted_at`. Callers can override
   * any of these via the `overrides` parameter — unset fields default to
   * the "clean slate" values (status='scheduled', all timestamps null,
   * charge_cancellation=false).
   *
   * This is designed to run in `test.beforeEach` so retries and parallel
   * workers always find the session in a known state.
   */
  resetSession: (sessionId: string, overrides?: SessionResetOverrides) => Promise<void>;

  /**
   * Delete all `session_history` rows for the given session except the
   * original "created" entry, so history assertions in the test start
   * from a clean baseline.
   */
  resetSessionHistory: (sessionId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Fixture definition
// ---------------------------------------------------------------------------

// Module-level connection cache. Playwright workers are process-isolated,
// so this is effectively per-worker. We cache both the sql instance and
// the seed state to avoid re-reading the JSON file on every test.
let cachedSql: postgres.Sql | null = null;
let cachedSeed: SeedState | null = null;

async function getConnection(): Promise<{ sql: postgres.Sql; seed: SeedState }> {
  if (cachedSql && cachedSeed) {
    return { sql: cachedSql, seed: cachedSeed };
  }

  const seed = await readSeedState();
  const sql = postgres(seed.databaseUrl, {
    max: 1,
    // Suppress NOTICE messages from Postgres (e.g., "table already exists").
    onnotice: () => {},
  });

  cachedSql = sql;
  cachedSeed = seed;

  return { sql, seed };
}

// Playwright's `test.extend()` uses a callback named after the fixture key
// (`db`) that receives `use` as its second parameter. ESLint's
// `react-hooks/rules-of-hooks` misidentifies `use(...)` as a React hook
// call inside a non-hook function. This is a false positive — `use` here
// is Playwright's fixture lifecycle callback, not React's `use()` hook.
/* eslint-disable react-hooks/rules-of-hooks */
export const test = base.extend<{ db: DbFixture }>({
  db: async ({}, use) => {
    const { sql } = await getConnection();

    const resetSession = async (
      sessionId: string,
      overrides: SessionResetOverrides = {},
    ): Promise<void> => {
      const status = overrides.status ?? 'scheduled';
      const confirmedAt = overrides.confirmedAt ?? null;
      const cancelledAt = overrides.cancelledAt ?? null;
      const cancellationReason = overrides.cancellationReason ?? null;
      const cancelledBy = overrides.cancelledBy ?? null;
      const cancellationNotice = overrides.cancellationNotice ?? null;
      const chargeCancellation = overrides.chargeCancellation ?? false;
      const deletedAt = overrides.deletedAt ?? null;

      // `updated_at` defaults to `now()` unless explicitly overridden.
      // The `lockedDone` session needs `updated_at = now() - interval '8 days'`
      // to test the edit-lock window, so callers can pass a specific Date.
      const hasUpdatedAtOverride = 'updatedAt' in overrides;
      const updatedAt = hasUpdatedAtOverride ? (overrides.updatedAt ?? null) : null;

      if (hasUpdatedAtOverride) {
        await sql`
          UPDATE public.sessions
          SET status               = ${status},
              confirmed_at         = ${confirmedAt},
              cancelled_at         = ${cancelledAt},
              cancellation_reason  = ${cancellationReason},
              cancelled_by         = ${cancelledBy},
              cancellation_notice  = ${cancellationNotice},
              charge_cancellation  = ${chargeCancellation},
              updated_at           = ${updatedAt},
              deleted_at           = ${deletedAt}
          WHERE id = ${sessionId};
        `;
      } else {
        await sql`
          UPDATE public.sessions
          SET status               = ${status},
              confirmed_at         = ${confirmedAt},
              cancelled_at         = ${cancelledAt},
              cancellation_reason  = ${cancellationReason},
              cancelled_by         = ${cancelledBy},
              cancellation_notice  = ${cancellationNotice},
              charge_cancellation  = ${chargeCancellation},
              updated_at           = now(),
              deleted_at           = ${deletedAt}
          WHERE id = ${sessionId};
        `;
      }
    };

    const resetSessionHistory = async (sessionId: string): Promise<void> => {
      // Keep only the original "created" entry. The seed in `global-setup.ts`
      // inserts exactly one history row per session with `action = 'created'`.
      // Deleting everything else gives tests a clean timeline to assert against
      // after the test performs its own mutation.
      await sql`
        DELETE FROM public.session_history
        WHERE session_id = ${sessionId}
          AND action != 'created';
      `;
    };

    await use({ sql, resetSession, resetSessionHistory });
  },
});
/* eslint-enable react-hooks/rules-of-hooks */

export { expect };
