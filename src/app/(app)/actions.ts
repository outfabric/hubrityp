'use server';

// Thin route shell for app-level Server Actions.
//
// The actual implementations live in their respective module directories
// (re-exported via barrel files). This file MUST stay tiny and carry the
// `'use server'` directive — that is what marks the module as a Server
// Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function, so we wrap the impls
// in thin async functions instead of bare `export ... from`.

import { signOut as signOutImpl } from '@/modules/auth';
import { markAllNotificationsRead, markNotificationRead } from '@/modules/notifications';
import { getTotalUnreadCountImpl, type GetTotalUnreadCountResult } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function signOut(): Promise<void> {
  return signOutImpl();
}

export async function getTotalUnreadCount(): Promise<GetTotalUnreadCountResult> {
  const supabase = await createServerClient();
  return getTotalUnreadCountImpl(supabase);
}

// Fire-and-forget mark-read actions wired to the notification bell. Each builds
// a cookie-bound (RLS-scoped) server client and delegates to the module impl,
// which authenticates via getUser() and authorizes ownership from the session —
// the `id` arg only identifies the row to mark and can never widen access.
export async function markNotificationReadAction(id: string): Promise<void> {
  const supabase = await createServerClient();
  await markNotificationRead(supabase, { id });
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const supabase = await createServerClient();
  await markAllNotificationsRead(supabase);
}
