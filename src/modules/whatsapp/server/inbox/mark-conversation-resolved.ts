import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type MarkConversationResolvedResult =
  | { ok: true; resolvedCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Marks all unresolved messages in a conversation as resolved by setting
 * `resolved_at = now()` on every `whatsapp_messages` row matching the
 * `patient_id` and `user_id` where `resolved_at IS NULL`.
 *
 * Returns the count of messages that were resolved.
 */
export async function markConversationResolvedImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<MarkConversationResolvedResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Update all unresolved messages for this conversation
  const result = await db
    .update(whatsappMessages)
    .set({ resolvedAt: sql`now()` })
    .where(
      and(
        eq(whatsappMessages.patientId, patientId),
        eq(whatsappMessages.userId, user.id),
        isNull(whatsappMessages.resolvedAt),
      ),
    )
    .returning({ id: whatsappMessages.id });

  return { ok: true, resolvedCount: result.length };
}
