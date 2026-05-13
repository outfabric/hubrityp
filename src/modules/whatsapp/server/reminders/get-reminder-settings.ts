import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { reminderSettings } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Shape returned to the caller — always has values (DB row or defaults). */
export interface ReminderSettingsData {
  earlyReminderHours: number | null;
  finalReminderHours: number | null;
  videoLinkMinutes: number;
  sendDuringNight: boolean;
}

export type GetReminderSettingsResult =
  | { ok: true; data: ReminderSettingsData }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Sensible defaults when the psychologist has not yet customized reminder
 * settings. Values match the product spec (early=24h, final=2h, video=30min,
 * night=false).
 */
const DEFAULTS: ReminderSettingsData = {
  earlyReminderHours: 24,
  finalReminderHours: 2,
  videoLinkMinutes: 30,
  sendDuringNight: false,
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves the reminder settings for the authenticated psychologist.
 *
 * If no `reminder_settings` row exists for the user, returns sensible
 * defaults so the UI always has something to render.
 */
export async function getReminderSettingsImpl(
  supabase: SupabaseClient,
): Promise<GetReminderSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query
  const rows = await db
    .select({
      earlyReminderHours: reminderSettings.earlyReminderHours,
      finalReminderHours: reminderSettings.finalReminderHours,
      videoLinkMinutes: reminderSettings.videoLinkMinutes,
      sendDuringNight: reminderSettings.sendDuringNight,
    })
    .from(reminderSettings)
    .where(eq(reminderSettings.userId, user.id))
    .limit(1);

  const data: ReminderSettingsData = rows[0] ?? DEFAULTS;

  return { ok: true, data };
}
