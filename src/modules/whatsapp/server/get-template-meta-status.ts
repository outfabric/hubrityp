import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

import { templateKeySchema } from '../lib/template-key-schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWILIO_CONTENT_API_BASE = 'https://content.twilio.com';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetTemplateMetaStatusResult =
  | { ok: true; metaStatus: string | null }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'twilio_error'; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build Twilio Content API basic auth header value. */
function twilioBasicAuth(): string | null {
  const sid = serverEnv.TWILIO_ACCOUNT_SID;
  const token = serverEnv.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/**
 * Map Twilio approval status strings to our local `meta_status` values.
 * Twilio returns: 'approved', 'rejected', 'pending', 'paused', 'disabled'.
 * We only store: 'approved', 'rejected', 'pending'.
 */
function mapTwilioStatus(twilioStatus: string): string {
  switch (twilioStatus.toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'paused':
    case 'disabled':
      return 'rejected';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Checks the current Meta/WhatsApp approval status for a template.
 *
 * If `meta_template_id` (Twilio Content SID) exists, queries the Twilio
 * Content API for the latest approval status, updates the local
 * `meta_status`, and returns it.
 *
 * If `meta_template_id` is null (template never submitted to Twilio),
 * returns the current local `meta_status` without making any API call.
 */
export async function getTemplateMetaStatusImpl(
  supabase: SupabaseClient,
  templateKey: string,
): Promise<GetTemplateMetaStatusResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate template_key
  const parsed = templateKeySchema.safeParse(templateKey);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      message: 'Tipo de template inválido.',
    };
  }

  // 3. Find existing template
  const [existing] = await db
    .select({
      id: messageTemplates.id,
      metaTemplateId: messageTemplates.metaTemplateId,
      metaStatus: messageTemplates.metaStatus,
    })
    .from(messageTemplates)
    .where(and(eq(messageTemplates.userId, user.id), eq(messageTemplates.templateKey, parsed.data)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. If no Content SID, return current local status
  if (!existing.metaTemplateId) {
    return { ok: true, metaStatus: existing.metaStatus };
  }

  // 5. Query Twilio Content API for approval status
  const authHeader = twilioBasicAuth();
  if (!authHeader) {
    logger.warn(
      { event: 'twilio_credentials_missing_on_status_check', templateKey: parsed.data },
      'Twilio credentials not configured — returning cached meta_status',
    );
    return { ok: true, metaStatus: existing.metaStatus };
  }

  try {
    const response = await fetch(
      `${TWILIO_CONTENT_API_BASE}/v1/Content/${encodeURIComponent(existing.metaTemplateId)}/ApprovalRequests/whatsapp`,
      {
        method: 'GET',
        headers: { Authorization: authHeader },
      },
    );

    if (!response.ok) {
      logger.error(
        {
          event: 'twilio_status_check_failed',
          status: response.status,
          contentSid: existing.metaTemplateId,
        },
        'Failed to fetch approval status from Twilio',
      );
      return {
        ok: false,
        error: 'twilio_error',
        message: `Erro ao consultar status do template (${response.status}).`,
      };
    }

    const data = (await response.json()) as { status?: string };
    const newStatus = mapTwilioStatus(data.status ?? 'pending');

    // 6. Update local meta_status
    await db
      .update(messageTemplates)
      .set({
        metaStatus: newStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(messageTemplates.id, existing.id));

    return { ok: true, metaStatus: newStatus };
  } catch (err: unknown) {
    logger.error(
      {
        event: 'twilio_status_check_error',
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'Unexpected error checking template approval status',
    );
    // Return cached status rather than failing the whole operation
    return { ok: true, metaStatus: existing.metaStatus };
  }
}
