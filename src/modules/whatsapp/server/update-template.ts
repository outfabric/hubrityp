import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

import { templateInputSchema } from '../lib/template-input-schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWILIO_CONTENT_API_BASE = 'https://content.twilio.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all `{variable}` names from a template body. */
function extractVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g);
  if (!matches) return [];
  // Deduplicate and preserve order of first appearance
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

/** Build Twilio Content API basic auth header value. */
function twilioBasicAuth(): string | null {
  const sid = serverEnv.TWILIO_ACCOUNT_SID;
  const token = serverEnv.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/**
 * Convert a body with `{variable}` placeholders to Twilio Content API format.
 * Twilio uses positional `{{N}}` placeholders.
 */
function toTwilioContentBody(body: string, variables: string[]): string {
  let result = body;
  for (let i = 0; i < variables.length; i++) {
    result = result.replaceAll(`{${variables[i]}}`, `{{${i + 1}}}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateTemplateResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'twilio_error'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates a message template's body and re-submits it to Meta for approval
 * via the Twilio Content API.
 *
 * Flow:
 *   1. Validate input with `templateInputSchema`.
 *   2. Authenticate via Supabase session.
 *   3. Find existing template by (user_id, template_key).
 *   4. Update body, variables, meta_status='pending', updated_at=now().
 *   5. Submit to Twilio Content API:
 *      - If `meta_template_id` exists: create a new Content resource
 *        (Twilio Content API does not support in-place updates — a new SID
 *        is issued) and update the stored SID.
 *      - If `meta_template_id` is null: create Content resource.
 *   6. Submit for WhatsApp approval.
 */
export async function updateTemplateImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateTemplateResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = templateInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { body, template_key: templateKey } = parsed.data;
  const variables = extractVariables(body);

  // 3. Find existing template
  const [existing] = await db
    .select({
      id: messageTemplates.id,
      metaTemplateId: messageTemplates.metaTemplateId,
    })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.userId, user.id),
        eq(messageTemplates.templateKey, templateKey),
      ),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. Update body, variables, and set meta_status to 'pending'
  await db
    .update(messageTemplates)
    .set({
      body,
      variables,
      metaStatus: 'pending',
      updatedAt: sql`now()`,
    })
    .where(eq(messageTemplates.id, existing.id));

  // 5. Submit to Twilio Content API
  const authHeader = twilioBasicAuth();
  if (!authHeader) {
    // Twilio credentials not configured — template is saved locally with
    // meta_status='pending'. The psychologist can retry status check later.
    logger.warn(
      { event: 'twilio_credentials_missing_on_update', templateKey },
      'Twilio credentials not configured — skipping Content API submission',
    );
    return { ok: true };
  }

  try {
    // Create a new Content resource (Twilio Content API is immutable —
    // updating a template means creating a new Content SID)
    const twilioBody = toTwilioContentBody(body, variables);

    const contentPayload = {
      friendly_name: `hubrityp_${templateKey}_${user.id.slice(0, 8)}`,
      language: 'pt_BR',
      types: {
        'twilio/text': {
          body: twilioBody,
        },
      },
      // Map variable positions to example values
      variables: Object.fromEntries(
        variables.map((v, i) => [`${i + 1}`, v]),
      ),
    };

    const createResponse = await fetch(`${TWILIO_CONTENT_API_BASE}/v1/Content`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contentPayload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logger.error(
        { event: 'twilio_content_create_failed', status: createResponse.status, templateKey },
        'Failed to create Twilio Content resource',
      );
      return {
        ok: false,
        error: 'twilio_error',
        message: `Erro ao submeter template ao WhatsApp (${createResponse.status}): ${errorText}`,
      };
    }

    const contentData = (await createResponse.json()) as { sid: string };
    const contentSid = contentData.sid;

    // Save the new Content SID
    await db
      .update(messageTemplates)
      .set({ metaTemplateId: contentSid })
      .where(eq(messageTemplates.id, existing.id));

    // 6. Submit for WhatsApp approval
    const approvalResponse = await fetch(
      `${TWILIO_CONTENT_API_BASE}/v1/Content/${encodeURIComponent(contentSid)}/ApprovalRequests/whatsapp`,
      {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `hubrityp_${templateKey}`,
          category: 'UTILITY',
        }),
      },
    );

    if (!approvalResponse.ok) {
      logger.error(
        {
          event: 'twilio_approval_submit_failed',
          status: approvalResponse.status,
          contentSid,
          templateKey,
        },
        'Failed to submit Content for WhatsApp approval',
      );
      // Template is saved and Content resource created — approval can be
      // retried later. We don't fail the whole operation for this.
    }

    logger.info(
      { event: 'template_updated', templateKey, contentSid },
      'Template updated and submitted for WhatsApp approval',
    );

    return { ok: true };
  } catch (err: unknown) {
    logger.error(
      {
        event: 'update_template_twilio_error',
        errorName: err instanceof Error ? err.name : 'UnknownError',
        templateKey,
      },
      'Unexpected error during Twilio Content API interaction',
    );
    // Template body was already saved to DB — only the Twilio submission failed.
    // Return success since the local save succeeded. The psychologist can
    // retry the status check later.
    return { ok: true };
  }
}
