import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

import { seedDefaultTemplates } from './seed-default-templates';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const completeConnectionInputSchema = z.object({
  senderSid: z.string().min(1, { message: 'Sender SID e obrigatorio.' }),
  verificationCode: z
    .string()
    .regex(/^\d{6}$/, { message: 'Codigo de verificacao deve ter 6 digitos.' }),
  phoneNumber: z.string().min(1, { message: 'Numero de telefone e obrigatorio.' }),
  displayName: z.string().min(1, { message: 'Nome de exibicao e obrigatorio.' }),
});

export type CompleteConnectionInput = z.infer<typeof completeConnectionInputSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CompleteTwilioConnectionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'verification_failed'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Completes the Twilio WhatsApp connection by verifying the SMS code and
 * persisting the account. This is step 2 of the connection flow.
 *
 * On success:
 *   1. Verifies the code with Twilio.
 *   2. Inserts a `whatsapp_accounts` row.
 *   3. Seeds the 6 default message templates (idempotent).
 */
export async function completeTwilioConnectionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CompleteTwilioConnectionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = completeConnectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { senderSid, verificationCode, phoneNumber, displayName } = parsed.data;
  const userId = user.id;

  // 3. Call Twilio to verify the sender code
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
        message: 'Erro de configuracao do servidor. Tente novamente.',
      };
    }

    const twilioUrl = `https://messaging.twilio.com/v2/Channels/Senders/${encodeURIComponent(senderSid)}/Verification`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const body = new URLSearchParams({
      code: verificationCode,
    });

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const status = response.status;

      // 400/422 typically means incorrect code
      if (status === 400 || status === 422) {
        return {
          ok: false,
          error: 'verification_failed',
          message: 'Codigo incorreto. Verifique e tente novamente.',
        };
      }

      logger.error(
        { event: 'twilio_verification_failed', statusCode: status },
        'Twilio verification failed',
      );
      return {
        ok: false,
        error: 'unknown',
        message: 'Nao foi possivel verificar o codigo. Tente novamente.',
      };
    }

    // 4. Insert whatsapp_accounts row
    await db.insert(whatsappAccounts).values({
      userId,
      provider: 'twilio',
      accountId: senderSid,
      phoneNumber,
      displayName,
      status: 'active',
      consentGivenAt: new Date(),
    });

    // 5. Seed default templates (idempotent — safe to call multiple times)
    await seedDefaultTemplates(userId);

    logger.info(
      { event: 'whatsapp_connection_complete', userId },
      'WhatsApp connection completed successfully',
    );

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string; constraint?: string };

    // Handle unique constraint violation (user already has an account)
    if (pgError.code === '23505') {
      return {
        ok: false,
        error: 'unknown',
        message: 'Voce ja tem um numero conectado.',
      };
    }

    logger.error(
      { event: 'complete_connection_error', errorName: err instanceof Error ? err.name : 'UnknownError' },
      'unexpected error completing Twilio connection',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao completar conexao. Tente novamente.',
    };
  }
}
