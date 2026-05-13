import 'server-only';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { notifications } from '@/shared/db/schema/notifications/tables';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client or transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/**
 * Payload accepted by the {@link notify} helper. Matches the design decision
 * for in-app notifications (Decision 8 in design.md).
 */
export interface NotificationPayload {
  /** Psychologist's `auth.users.id` — the notification recipient. */
  userId: string;
  /** Discriminator for notification kind (e.g., 'session_confirmed'). */
  type: string;
  /** Short, human-readable title shown in the notification list (PT-BR). */
  title: string;
  /** Optional longer body with details. */
  body?: string;
  /** Optional deep-link URL (e.g., /app/agenda?session=<id>). */
  actionUrl?: string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Insert a single in-app notification for a psychologist.
 *
 * Intended to be called from background jobs (Inngest functions) using the
 * service-role database client, which bypasses RLS. The function is
 * intentionally thin — it validates nothing beyond what Postgres enforces
 * (NOT NULL constraints) so callers remain responsible for payload
 * correctness.
 *
 * @param db - Drizzle client (service-role, bypasses RLS).
 * @param payload - Notification data to insert.
 * @returns The inserted notification's `id`.
 */
export async function notify(
  db: DrizzleDb,
  payload: NotificationPayload,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      actionUrl: payload.actionUrl ?? null,
    })
    .returning({ id: notifications.id });

  // The returning clause always yields exactly one row for a single insert,
  // but guard defensively to satisfy strict TS.
  if (!row) {
    throw new Error('Failed to insert notification — no row returned');
  }

  return row;
}
