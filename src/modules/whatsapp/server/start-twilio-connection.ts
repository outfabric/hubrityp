import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { phoneNumberSchema } from '@/modules/whatsapp/lib/phone-number-schema';
import { db } from '@/shared/db/client';
import { whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const startConnectionInputSchema = z.object({
  phone: phoneNumberSchema,
  displayName: z
    .string()
    .min(1, { message: 'O nome de exibicao e obrigatorio.' })
    .max(120, { message: 'O nome de exibicao deve ter no maximo 120 caracteres.' }),
  consent: z.literal(true, {
    message: 'Voce precisa confirmar o consentimento LGPD para continuar.',
  }),
});

export type StartConnectionInput = z.infer<typeof startConnectionInputSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type StartTwilioConnectionResult =
  | { ok: true; senderSid: string; verificationMethod: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'already_connected'; message: string }
  | { ok: false; error: 'twilio_error'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Initiates a Twilio WhatsApp sender registration for the authenticated
 * psychologist. This is step 1 of the two-step connection flow: create a
 * sender on Twilio, which sends a verification code via SMS to the phone.
 *
 * Preconditions:
 *   - User must be authenticated.
 *   - User must not have an active (non-disconnected) account.
 *   - LGPD consent must be explicitly given.
 *
 * The returned `senderSid` and `verificationMethod` are needed by step 2
 * (`completeTwilioConnectionImpl`).
 */
export async function startTwilioConnectionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<StartTwilioConnectionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = startConnectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { phone, displayName } = parsed.data;
  const userId = user.id;

  // 3. Check for existing active account
  const existingAccounts = await db
    .select({ id: whatsappAccounts.id })
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.userId, userId), ne(whatsappAccounts.status, 'disconnected')))
    .limit(1);

  if (existingAccounts.length > 0) {
    return {
      ok: false,
      error: 'already_connected',
      message: 'Voce ja tem um numero conectado. Desconecte o atual antes de conectar outro.',
    };
  }

  // 4. Call Twilio Channels Senders API
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
        error: 'twilio_error',
        message: 'Nao foi possivel conectar o WhatsApp. Tente novamente.',
      };
    }

    const twilioUrl = `https://messaging.twilio.com/v2/Channels/Senders`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const body = new URLSearchParams({
      sender_id: `whatsapp:${phone}`,
      'profile.name': displayName,
      'webhook.callback_url': `${serverEnv.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase', 'app') ?? 'https://app.hubrityp.com.br'}/api/webhooks/whatsapp/inbound`,
      'webhook.status_callback_url': `${serverEnv.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase', 'app') ?? 'https://app.hubrityp.com.br'}/api/webhooks/whatsapp/status`,
    });

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { event: 'twilio_sender_creation_failed', statusCode: response.status },
        'Twilio sender creation failed',
      );
      // Log sanitized error (no PII)
      logger.debug(
        {
          event: 'twilio_sender_creation_error_detail',
          statusCode: response.status,
          hasBody: !!errorText,
        },
        'Twilio error detail',
      );
      return {
        ok: false,
        error: 'twilio_error',
        message: 'Nao foi possivel conectar o WhatsApp. Tente novamente.',
      };
    }

    const result = (await response.json()) as {
      sid: string;
      configuration?: { verification_method?: string };
    };

    return {
      ok: true,
      senderSid: result.sid,
      verificationMethod: result.configuration?.verification_method ?? 'sms',
    };
  } catch (err: unknown) {
    logger.error(
      {
        event: 'twilio_connection_error',
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'unexpected error during Twilio sender creation',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao conectar WhatsApp. Tente novamente.',
    };
  }
}
