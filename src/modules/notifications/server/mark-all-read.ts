import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import type { NotificationsUnauthorizedResult } from './list-notifications';

export interface MarkAllReadResult {
  ok: true;
  /** Number of notifications transitioned from unread to read on this call. */
  updated: number;
}

/**
 * Marks all of the authenticated psychologist's unread notifications as read.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. The UPDATE is scoped `WHERE user_id = session.uid AND read_at IS NULL`
 *      — defense in depth on top of the table's RLS UPDATE policy (`db`
 *      bypasses RLS). It can only ever touch the caller's own rows; no
 *      caller-supplied id is accepted, so a cross-user mark-all is impossible.
 */
export async function markAllNotificationsRead(
  supabase: SupabaseClient,
): Promise<MarkAllReadResult | NotificationsUnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { notifications } = await import('@/shared/db/schema/notifications/tables');

  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });

  logger.debug({
    module: 'notifications',
    event: 'mark_all_read',
    userId,
    updated: updated.length,
  });

  return { ok: true, updated: updated.length };
}
