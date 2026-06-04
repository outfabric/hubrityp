'use server';

// Thin route shell for notification-preferences Server Actions.
//
// The actual implementation lives in `src/modules/notifications/server/`
// (re-exported from `@/modules/notifications`). This file MUST stay thin and
// carry the `'use server'` directive — that is what marks it as a Server Action
// entry point for the Next.js compiler. Every export of a `'use server'` file
// MUST be an async function; types cannot be re-exported from here.

import type { UpdateNotificationPreferencesResult } from '@/modules/notifications';
import { updateNotificationPreferencesImpl } from '@/modules/notifications';
import { createServerClient } from '@/shared/supabase/server';

export async function updateNotificationPreferences(
  input: unknown,
): Promise<UpdateNotificationPreferencesResult> {
  const supabase = await createServerClient();
  return updateNotificationPreferencesImpl(supabase, input);
}
