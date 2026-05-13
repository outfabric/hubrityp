import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type HealthCheckWhatsappResult =
  | { ok: true; status: 'active' | 'disconnected' | 'error' }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Checks the health of the psychologist's WhatsApp connection by querying
 * the Twilio Channels Senders API for the sender's status.
 *
 * Behavior:
 *   - If account is 'disconnected': returns early without calling Twilio.
 *   - If Twilio reports ONLINE: status stays 'active'.
 *   - If Twilio reports OFFLINE/ERROR: status transitions to 'error'.
 *   - `last_health_check_at` is updated in all non-disconnected cases.
 */
export async function healthCheckWhatsappImpl(
  supabase: SupabaseClient,
): Promise<HealthCheckWhatsappResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Find account
  const [account] = await db
    .select({
      id: whatsappAccounts.id,
      accountId: whatsappAccounts.accountId,
      status: whatsappAccounts.status,
    })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, userId))
    .limit(1);

  if (!account) {
    return { ok: false, error: 'not_found' };
  }

  // 3. If disconnected, return early without calling Twilio
  if (account.status === 'disconnected') {
    return { ok: true, status: 'disconnected' };
  }

  // 4. Query Twilio for sender status
  try {
    const accountSid = serverEnv.TWILIO_ACCOUNT_SID;
    const authToken = serverEnv.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      logger.error(
        { event: 'twilio_credentials_missing' },
        'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not configured',
      );
      return {
        ok: false,
        error: 'unknown',
        message: 'Erro de configuracao do servidor.',
      };
    }

    const twilioUrl = `https://messaging.twilio.com/v2/Channels/Senders/${encodeURIComponent(account.accountId)}`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(twilioUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    let newStatus: 'active' | 'error' = 'error';

    if (response.ok) {
      const result = (await response.json()) as {
        status?: string;
      };

      // Twilio sender status: CREATING, ONLINE, OFFLINE, ERROR, etc.
      newStatus = result.status === 'ONLINE' ? 'active' : 'error';
    } else {
      logger.warn(
        { event: 'twilio_health_check_failed', statusCode: response.status },
        'Twilio health check API returned non-OK status',
      );
      newStatus = 'error';
    }

    // 5. Update local row
    await db
      .update(whatsappAccounts)
      .set({
        status: newStatus,
        lastHealthCheckAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(whatsappAccounts.id, account.id));

    return { ok: true, status: newStatus };
  } catch (err: unknown) {
    logger.error(
      { event: 'health_check_error', errorName: err instanceof Error ? err.name : 'UnknownError' },
      'unexpected error during WhatsApp health check',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao verificar conexao. Tente novamente.',
    };
  }
}
