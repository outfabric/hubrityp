import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { notificationPreferences } from '@/shared/db/schema/onboarding/tables';

import type { NotificationsUnauthorizedResult } from './list-notifications';
import type { NotificationPreferencesView } from './update-preferences';

export interface GetNotificationPreferencesResult {
  ok: true;
  preferences: NotificationPreferencesView;
}

/**
 * Default preferences for a user who has never saved any (no row yet). All
 * toggles default ON, matching the table column defaults, so the UI shows the
 * opted-in state before the first save materializes the row.
 */
const DEFAULT_PREFERENCES: NotificationPreferencesView = {
  emailDaily: true,
  emailWeekly: true,
  emailCritical: true,
  inAppSound: true,
};

/**
 * Reads the authenticated psychologist's notification preferences for the
 * Configurações → Notificações page.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. The query is scoped `user_id = session.uid` — defense in depth on top of
 *      RLS (`db` bypasses RLS). No caller-supplied id is ever accepted.
 *
 * Returns the column defaults (all ON) when the user has no row yet, so the
 * page never has to special-case a missing row.
 */
export async function getNotificationPreferencesForOwner(
  supabase: SupabaseClient,
): Promise<GetNotificationPreferencesResult | NotificationsUnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const rows = await db
    .select({
      emailDaily: notificationPreferences.emailDaily,
      emailWeekly: notificationPreferences.emailWeekly,
      emailCritical: notificationPreferences.emailCritical,
      inAppSound: notificationPreferences.inAppSound,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: true, preferences: DEFAULT_PREFERENCES };
  }

  // `email_critical` is server-enforced TRUE; surface it as such defensively in
  // case a legacy row ever holds FALSE.
  return {
    ok: true,
    preferences: {
      emailDaily: row.emailDaily,
      emailWeekly: row.emailWeekly,
      emailCritical: true,
      inAppSound: row.inAppSound,
    },
  };
}
