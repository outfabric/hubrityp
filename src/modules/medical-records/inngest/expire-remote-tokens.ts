/**
 * Hourly cron that identifies expired remote scale application tokens.
 *
 * Per design: the cron is an observability/cleanup layer — primary expiry
 * enforcement happens at submission time (the public submission endpoint
 * rejects tokens whose `token_expires_at < now()`). This function only
 * logs the count of expired-but-uncompleted applications for monitoring
 * dashboards and alerting.
 *
 * Runs every hour at minute 0, America/Sao_Paulo.
 */

import { and, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { scaleApplications } from '@/shared/db/schema/medical-records/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client or transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface ExpiredTokensDeps {
  db: DrizzleDb;
}

// ---------------------------------------------------------------------------
// Query logic (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Counts scale applications whose remote token has expired but that were
 * never completed by the patient. Uses a simple COUNT(*) with conditions
 * on `token_expires_at < now()` and `completed_at IS NULL`.
 */
export async function countExpiredPendingTokens(deps: ExpiredTokensDeps): Promise<number> {
  const { db } = deps;

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scaleApplications)
    .where(
      and(lt(scaleApplications.tokenExpiresAt, sql`now()`), isNull(scaleApplications.completedAt)),
    );

  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const expireRemoteTokens = inngest.createFunction(
  {
    id: 'scales/expire-remote-tokens',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 0 * * * *' }],
  },
  async ({ step, logger }) => {
    const count = await step.run('count-expired-tokens', async () => {
      // Import DB client lazily to avoid module-level side effects in tests
      const { db } = await import('@/shared/db/client');

      return countExpiredPendingTokens({ db });
    });

    logger.info(
      {
        event: 'expire_remote_tokens_scan_complete',
        expiredPendingCount: count,
      },
      `Found ${count} expired remote scale token(s) pending completion`,
    );

    return { expiredPendingCount: count };
  },
);
