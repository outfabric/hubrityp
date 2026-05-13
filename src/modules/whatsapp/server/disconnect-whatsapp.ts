import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DisconnectWhatsappResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'already_disconnected' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Soft-disconnects the psychologist's WhatsApp account by setting
 * `status = 'disconnected'`. The row is preserved for audit history.
 *
 * Templates are NOT deleted — they remain in the database unchanged so
 * reconnection can reuse them.
 */
export async function disconnectWhatsappImpl(
  supabase: SupabaseClient,
): Promise<DisconnectWhatsappResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Find existing account
  const [existing] = await db
    .select({ id: whatsappAccounts.id, status: whatsappAccounts.status })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, userId))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  if (existing.status === 'disconnected') {
    return { ok: false, error: 'already_disconnected' };
  }

  // 3. Update status to 'disconnected'
  try {
    await db
      .update(whatsappAccounts)
      .set({
        status: 'disconnected',
        updatedAt: sql`now()`,
      })
      .where(and(eq(whatsappAccounts.id, existing.id), eq(whatsappAccounts.userId, userId)));

    logger.info(
      { event: 'whatsapp_disconnected', userId },
      'WhatsApp account disconnected',
    );

    return { ok: true };
  } catch (err: unknown) {
    logger.error(
      { event: 'disconnect_whatsapp_failed', errorName: err instanceof Error ? err.name : 'UnknownError' },
      'unexpected error disconnecting WhatsApp',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao desconectar WhatsApp. Tente novamente.',
    };
  }
}
