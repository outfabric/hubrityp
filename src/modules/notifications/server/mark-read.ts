import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import { markReadInputSchema } from '../lib/schemas';

import type { NotificationsUnauthorizedResult } from './list-notifications';

export interface MarkReadResult {
  ok: true;
  /** True only when a row actually transitioned to read on THIS call. */
  updated: boolean;
}

export interface NotificationsInvalidInputResult {
  ok: false;
  code: 'INVALID_INPUT';
}

/**
 * Marks a single notification as read for the authenticated psychologist.
 *
 * Security (closes the IDOR vector — see design.md "markRead authorizes from
 * session, never id alone"):
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Validate the input with Zod at the boundary — a non-UUID `id` is
 *      rejected before any query runs (returns `INVALID_INPUT`, never a raw
 *      error).
 *   3. The UPDATE is scoped `WHERE id = :input.id AND user_id = session.uid`
 *      (and the `read_at IS NULL` guard makes a re-mark a no-op). `db` bypasses
 *      RLS, so this server-side ownership predicate — backstopped by the
 *      table's RLS UPDATE policy — is what guarantees user B can never mark
 *      user A's notification: a mismatched owner matches zero rows.
 *
 * Errors are sanitized: callers only ever see the stable
 * `{ ok, code }` shapes, never a Postgres message, table name, or stack trace.
 */
export async function markNotificationRead(
  supabase: SupabaseClient,
  input: unknown,
): Promise<MarkReadResult | NotificationsUnauthorizedResult | NotificationsInvalidInputResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const parsed = markReadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const userId = user.id;
  const { id } = parsed.data;

  const { notifications } = await import('@/shared/db/schema/notifications/tables');

  // `.returning` lets us report whether THIS call performed the transition
  // without a second read. A row is returned only when the notification exists,
  // belongs to the caller, AND was still unread.
  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)),
    )
    .returning({ id: notifications.id });

  logger.debug({
    module: 'notifications',
    event: 'mark_read',
    userId,
    notificationId: id,
    updated: updated.length > 0,
  });

  return { ok: true, updated: updated.length > 0 };
}
