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
import { getTotalUnreadCountImpl, type GetTotalUnreadCountResult } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function signOut(): Promise<void> {
  return signOutImpl();
}

export async function getTotalUnreadCount(): Promise<GetTotalUnreadCountResult> {
  const supabase = await createServerClient();
  return getTotalUnreadCountImpl(supabase);
}
