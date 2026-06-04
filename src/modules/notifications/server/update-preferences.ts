import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import {
  notificationPreferences,
  type NotificationPreferences as NotificationPreferencesRow,
} from '@/shared/db/schema/onboarding/tables';
import { logger } from '@/shared/lib/logger';

import { updateNotificationPreferencesInputSchema } from '../lib/preferences-schema';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** The owner's persisted preference toggles, as returned to the client. */
export interface NotificationPreferencesView {
  emailDaily: boolean;
  emailWeekly: boolean;
  /** Always TRUE — `email_critical` is server-enforced and non-disableable. */
  emailCritical: boolean;
  inAppSound: boolean;
}

export type UpdateNotificationPreferencesResult =
  | { ok: true; preferences: NotificationPreferencesView }
  | { ok: false; code: 'UNAUTHORIZED' }
  | { ok: false; code: 'INVALID_INPUT' }
  | { ok: false; code: 'UNKNOWN' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates or updates the authenticated psychologist's notification preferences.
 *
 * Security (four-layer, with this action as the third):
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()` —
 *      `getSession` does not revalidate the cookie with GoTrue and is unsafe
 *      for authorization).
 *   2. Validate the input with Zod at the boundary. A malformed body is
 *      rejected before any query runs (returns `INVALID_INPUT`, never a raw
 *      error).
 *   3. Authorize from the session: `user_id` comes from `user.id`, NEVER from
 *      the client payload, so a forged user id in the input cannot target
 *      another tenant's row (IDOR-safe). The UPSERT `ON CONFLICT (user_id)`
 *      writes exactly one owner-scoped row; the table's RLS UPDATE/INSERT
 *      policies are the backstop even though `db` bypasses RLS.
 *   4. `email_critical` is NON-DISABLEABLE and server-enforced: regardless of
 *      what the client sends, the persisted value is coerced to TRUE. Critical
 *      operational/security/LGPD emails must always reach the user (see the
 *      `notification_preferences` table comment).
 *
 * Errors are sanitized: callers only ever see the stable `{ ok, code }` shapes,
 * never a Postgres message, table name, or stack trace.
 */
export async function updateNotificationPreferencesImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateNotificationPreferencesResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const parsed = updateNotificationPreferencesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { emailDaily, emailWeekly, inAppSound } = parsed.data;
  // Server is the authority for `email_critical`: it is coerced to TRUE here,
  // so even a client that submits `emailCritical: false` (the schema strips it)
  // can never persist a disabled critical-email flag.
  const emailCritical = true;

  try {
    const [row] = await db
      .insert(notificationPreferences)
      .values({
        userId: user.id,
        emailDaily,
        emailWeekly,
        emailCritical,
        inAppSound,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          emailDaily,
          emailWeekly,
          emailCritical,
          inAppSound,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        emailDaily: notificationPreferences.emailDaily,
        emailWeekly: notificationPreferences.emailWeekly,
        emailCritical: notificationPreferences.emailCritical,
        inAppSound: notificationPreferences.inAppSound,
      });

    if (!row) {
      // Should be unreachable: an upsert with RETURNING always yields a row.
      logger.error(
        { module: 'notifications', event: 'update_preferences_no_row', userId: user.id },
        'upsert returned no row',
      );
      return { ok: false, code: 'UNKNOWN' };
    }

    logger.debug({
      module: 'notifications',
      event: 'update_preferences',
      userId: user.id,
    });

    return { ok: true, preferences: toView(row) };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { module: 'notifications', event: 'update_preferences_failed', errorCode: pgError.code },
      'unexpected error upserting notification preferences',
    );
    return { ok: false, code: 'UNKNOWN' };
  }
}

/** Narrows a persisted row down to the client-facing view shape. */
function toView(
  row: Pick<
    NotificationPreferencesRow,
    'emailDaily' | 'emailWeekly' | 'emailCritical' | 'inAppSound'
  >,
): NotificationPreferencesView {
  return {
    emailDaily: row.emailDaily,
    emailWeekly: row.emailWeekly,
    emailCritical: row.emailCritical,
    inAppSound: row.inAppSound,
  };
}
