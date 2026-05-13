import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ToggleSessionRemindersResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Toggles the `reminders_disabled` flag on a specific session.
 *
 * Ownership is verified by filtering on both `session.id` and
 * `session.user_id` — if the row is not found (either because the
 * session doesn't exist or belongs to another user) the function
 * returns `not_found`.
 */
export async function toggleSessionRemindersImpl(
  supabase: SupabaseClient,
  sessionId: string,
  remindersDisabled: boolean,
): Promise<ToggleSessionRemindersResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Update with ownership check (user_id filter)
  const updated = await db
    .update(sessions)
    .set({
      remindersDisabled,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)))
    .returning({ id: sessions.id });

  if (updated.length === 0) {
    return { ok: false, error: 'not_found' };
  }

  logger.info(
    { event: 'session_reminders_toggled', sessionId, remindersDisabled },
    'Session reminders toggled',
  );

  return { ok: true };
}
