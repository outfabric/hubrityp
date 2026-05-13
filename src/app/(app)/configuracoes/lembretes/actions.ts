'use server';

// Thin route shell for reminder-settings Server Actions.
//
// The actual implementations live in `src/modules/whatsapp/server/reminders/`
// (re-exported from `@/modules/whatsapp`). This file carries `'use server'`
// so Next.js treats every export as a Server Action entry point.

import type { GetReminderSettingsResult, SaveReminderSettingsResult } from '@/modules/whatsapp';
import { getReminderSettingsImpl, saveReminderSettingsImpl } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function getReminderSettings(): Promise<GetReminderSettingsResult> {
  const supabase = await createServerClient();
  return getReminderSettingsImpl(supabase);
}

export async function saveReminderSettings(input: unknown): Promise<SaveReminderSettingsResult> {
  const supabase = await createServerClient();
  return saveReminderSettingsImpl(supabase, input);
}
