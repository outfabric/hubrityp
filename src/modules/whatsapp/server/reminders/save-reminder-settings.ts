import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { reminderSettingsSchema } from '@/modules/whatsapp/lib/reminders/reminder-settings-schema';
import { db } from '@/shared/db/client';
import { reminderSettings } from '@/shared/db/schema/whatsapp/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SaveReminderSettingsResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validates input with `reminderSettingsSchema` and upserts the
 * psychologist's reminder settings (INSERT ON CONFLICT user_id DO UPDATE).
 *
 * Revalidates the settings page cache after a successful write.
 */
export async function saveReminderSettingsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SaveReminderSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = reminderSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night } =
    parsed.data;

  // 3. Upsert — INSERT ... ON CONFLICT (user_id) DO UPDATE
  await db
    .insert(reminderSettings)
    .values({
      userId: user.id,
      earlyReminderHours: early_reminder_hours,
      finalReminderHours: final_reminder_hours,
      videoLinkMinutes: video_link_minutes,
      sendDuringNight: send_during_night,
    })
    .onConflictDoUpdate({
      target: reminderSettings.userId,
      set: {
        earlyReminderHours: early_reminder_hours,
        finalReminderHours: final_reminder_hours,
        videoLinkMinutes: video_link_minutes,
        sendDuringNight: send_during_night,
        updatedAt: sql`now()`,
      },
    });

  logger.info(
    { event: 'reminder_settings_saved', userId: user.id },
    'Reminder settings upserted successfully',
  );

  // 4. Invalidate cache
  revalidatePath('/app/configuracoes/lembretes');

  return { ok: true };
}
