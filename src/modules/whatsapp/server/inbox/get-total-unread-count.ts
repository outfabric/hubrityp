import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { whatsappConversations } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type GetTotalUnreadCountResult =
  | { ok: true; totalUnread: number }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns the sum of `unread_count` across all conversations for the
 * authenticated psychologist. This is a lightweight aggregate query used
 * by the sidebar badge — no pagination, no joins, no filters.
 */
export async function getTotalUnreadCountImpl(
  supabase: SupabaseClient,
): Promise<GetTotalUnreadCountResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const [row] = await db
    .select({
      totalUnread: sql<number>`coalesce(sum(${whatsappConversations.unreadCount}), 0)::int`,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.userId, user.id));

  return { ok: true, totalUnread: row?.totalUnread ?? 0 };
}
