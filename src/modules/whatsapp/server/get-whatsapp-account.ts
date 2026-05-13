import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { whatsappAccounts, type WhatsappAccount } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetWhatsappAccountResult =
  | { ok: true; account: WhatsappAccount }
  | { ok: true; account: null }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves the WhatsApp account for the authenticated psychologist.
 *
 * Returns the account row or `null` if no account exists. Only one account
 * per psychologist is allowed (UNIQUE constraint on `user_id`).
 */
export async function getWhatsappAccountImpl(
  supabase: SupabaseClient,
): Promise<GetWhatsappAccountResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query
  const rows = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, user.id))
    .limit(1);

  return { ok: true, account: rows[0] ?? null };
}
