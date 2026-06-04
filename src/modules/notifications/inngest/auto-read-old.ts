/**
 * Auto-read old notifications cron — Inngest scheduled function that marks
 * in-app notifications older than 30 days as read (RF-11.17).
 *
 * On each daily tick it sets `read_at = now()` for every row where:
 *   - `read_at IS NULL` (still unread), and
 *   - `created_at < now() - INTERVAL '30 days'` (older than the retention window).
 *
 * The function NEVER deletes rows — auto-read simply moves stale notifications
 * out of the unread set; they remain available in notification history.
 *
 * Service-role / RLS justification: this is a system Inngest cron job with no
 * user session in scope. It operates across ALL psychologists' notifications,
 * so there is no single `auth.uid()` to scope by. The Drizzle `db` client
 * bypasses RLS for exactly this reason (system-scoped batch operation, not
 * reachable from any user input path).
 *
 * Runs daily at 03:00 America/Sao_Paulo (off-peak for sa-east-1).
 */

import { and, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { notifications } from '@/shared/db/schema/notifications/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — `any` schema generic is intentional for testability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface AutoReadOldDeps {
  db: DrizzleDb;
}

export interface AutoReadOldResult {
  /** Number of notifications transitioned from unread to read in this run. */
  readCount: number;
}

/** Retention window after which an unread notification is auto-read. */
const RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Marks all unread notifications older than {@link RETENTION_DAYS} days as read.
 *
 * This is a pure bulk UPDATE (no DELETE). Both the `read_at IS NULL` and
 * `created_at < cutoff` predicates are matched against the
 * `notifications_user_id_read_at_idx` / `created_at` columns. Returns the
 * number of rows updated.
 */
export async function markOldNotificationsRead(deps: AutoReadOldDeps): Promise<number> {
  const { db } = deps;

  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        isNull(notifications.readAt),
        lt(notifications.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`),
      ),
    )
    .returning({ id: notifications.id });

  return updated.length;
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const autoReadOldNotifications = inngest.createFunction(
  {
    id: 'notifications/auto-read-old',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 0 3 * * *' }],
  },
  async ({ step, logger }): Promise<AutoReadOldResult> => {
    const readCount = await step.run('auto-read-old-notifications', async () => {
      // Import the DB client lazily to avoid module-level side effects in tests
      // and to keep this cron edge-free (postgres-js pulls node:crypto).
      const { db } = await import('@/shared/db/client');

      // Service-role: the Drizzle client bypasses RLS. Justified because this
      // is a system cron operating across all users with no `auth.uid()`.
      return markOldNotificationsRead({ db });
    });

    logger.info(
      { event: 'notifications_auto_read_complete', readCount },
      `Auto-read ${readCount} notification(s) older than ${RETENTION_DAYS} days`,
    );

    return { readCount };
  },
);
