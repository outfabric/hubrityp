/**
 * Daily cron that expires completed prontuario export PDFs.
 *
 * Runs at 03:00 America/Sao_Paulo (06:00 UTC) daily. Selects all
 * `prontuario_exports` rows with `status='ready'` and `expires_at < now()`,
 * updates their status to `'expired'`, and deletes the corresponding Storage
 * objects. Storage deletion is non-fatal — if it fails for a particular file,
 * the error is logged and processing continues with the next row.
 *
 * **Service-role justification:** This runs as a background job with no user
 * session. The Drizzle `db` client connects as the DB owner (bypasses RLS)
 * and the Supabase admin client uses the service-role key to delete Storage
 * objects. Both are necessary because there is no user cookie to carry.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { prontuarioExports } from '@/shared/db/schema/medical-records/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/** Minimal Storage client interface for testability. */
interface StorageClient {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
}

interface ExpiredExportRow {
  id: string;
  storagePath: string | null;
  userId: string;
}

export interface ExpireExportsDeps {
  db: DrizzleDb;
  storageClient: StorageClient;
}

// ---------------------------------------------------------------------------
// Core logic (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Finds expired-but-ready exports, marks them as expired, and deletes
 * their Storage objects (non-fatal on failure).
 */
export async function expireExports(
  deps: ExpireExportsDeps,
  logger: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
  },
): Promise<{ expiredCount: number; storageDeleteErrors: number }> {
  const { db, storageClient } = deps;

  // 1. Select expired-ready rows
  const expiredRows: ExpiredExportRow[] = await db
    .select({
      id: prontuarioExports.id,
      storagePath: prontuarioExports.storagePath,
      userId: prontuarioExports.userId,
    })
    .from(prontuarioExports)
    .where(and(eq(prontuarioExports.status, 'ready'), lt(prontuarioExports.expiresAt, sql`now()`)));

  if (expiredRows.length === 0) {
    return { expiredCount: 0, storageDeleteErrors: 0 };
  }

  let storageDeleteErrors = 0;

  for (const row of expiredRows) {
    // 2. Update status to expired (service-role — no user session)
    await db
      .update(prontuarioExports)
      .set({ status: 'expired' })
      .where(eq(prontuarioExports.id, row.id));

    // 3. Delete Storage object (non-fatal — log error, continue)
    if (row.storagePath) {
      const { error } = await storageClient.storage
        .from('prontuario-exports')
        .remove([row.storagePath]);

      if (error) {
        storageDeleteErrors++;
        logger.error(
          {
            event: 'expire_exports_storage_delete_failed',
            exportId: row.id,
            storageError: error.message,
          },
          `Failed to delete Storage object for expired export ${row.id}`,
        );
      }
    }
  }

  return { expiredCount: expiredRows.length, storageDeleteErrors };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const expireProntuarioExportsCron = inngest.createFunction(
  {
    id: 'prontuario/expire-exports',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 0 3 * * *' }],
  },
  async ({ step, logger }) => {
    const result = await step.run('expire-ready-exports', async () => {
      // Lazy imports to avoid module-level side effects in tests
      const { db } = await import('@/shared/db/client');
      const { createClient } = await import('@supabase/supabase-js');
      const { serverEnv } = await import('@/shared/env');
      const { clientEnv } = await import('@/shared/env/client');

      // service-role Supabase client — required for Storage deletions
      // in a background job with no user session.
      const storageClient = createClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      );

      return expireExports({ db, storageClient }, logger);
    });

    logger.info(
      {
        event: 'expire_exports_cron_complete',
        expiredCount: result.expiredCount,
        storageDeleteErrors: result.storageDeleteErrors,
      },
      `Expired ${result.expiredCount} prontuario export(s), ${result.storageDeleteErrors} storage deletion error(s)`,
    );

    return result;
  },
);
