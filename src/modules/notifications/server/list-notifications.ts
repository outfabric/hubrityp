import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

/** Max notifications returned in one read — bounds payload size. */
const LIST_LIMIT = 50;

/**
 * A single notification as surfaced to the bell/dropdown. Carries only display
 * fields — `type` (a discriminator), the PT-BR `title`/`body`, a server-stored
 * `actionUrl`, and read/created timestamps. No cross-tenant data: every row is
 * owner-scoped (see security note on {@link listNotifications}).
 */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  /** Read instant, or null when still unread. */
  readAt: Date | null;
  createdAt: Date;
}

export interface ListNotificationsResult {
  ok: true;
  notifications: NotificationView[];
}

export interface NotificationsUnauthorizedResult {
  ok: false;
  code: 'UNAUTHORIZED';
}

/**
 * Returns the authenticated psychologist's notifications, newest first
 * (capped at {@link LIST_LIMIT}).
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`) — the
 *      identity is revalidated against GoTrue before any read.
 *   2. The query is scoped `user_id = session.uid` — defense in depth on top of
 *      RLS (`db` bypasses RLS). No caller-supplied id is ever accepted, so a
 *      cross-tenant read is impossible.
 */
export async function listNotifications(
  supabase: SupabaseClient,
): Promise<ListNotificationsResult | NotificationsUnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { notifications } = await import('@/shared/db/schema/notifications/tables');

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      actionUrl: notifications.actionUrl,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(LIST_LIMIT);

  logger.debug({ module: 'notifications', event: 'list', userId, count: rows.length });

  return { ok: true, notifications: rows };
}
