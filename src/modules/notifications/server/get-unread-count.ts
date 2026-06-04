import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import type { NotificationsUnauthorizedResult } from './list-notifications';

export interface UnreadCountResult {
  ok: true;
  /** Number of unread notifications for the caller. */
  count: number;
}

/**
 * Returns the count of unread notifications (read_at IS NULL) for the
 * authenticated psychologist — drives the bell badge.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. The query is scoped `user_id = session.uid` — defense in depth on top of
 *      RLS (`db` bypasses RLS). No caller-supplied id is ever accepted.
 */
export async function getUnreadCount(
  supabase: SupabaseClient,
): Promise<UnreadCountResult | NotificationsUnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { notifications } = await import('@/shared/db/schema/notifications/tables');

  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  const unread = row?.value ?? 0;

  logger.debug({ module: 'notifications', event: 'unread_count', userId, count: unread });

  return { ok: true, count: unread };
}
