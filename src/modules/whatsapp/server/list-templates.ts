import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Preview-sized template for the list page. Body is truncated to 200 chars. */
export interface TemplatePreview {
  id: string;
  templateKey: string;
  body: string;
  variables: unknown;
  metaStatus: string | null;
  isDefault: boolean | null;
}

export type ListTemplatesResult =
  | { ok: true; templates: TemplatePreview[] }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const BODY_PREVIEW_LENGTH = 200;

/**
 * Lists all message templates for the authenticated psychologist, ordered
 * by `template_key ASC`. Template bodies are truncated to 200 characters
 * for the list/card preview.
 */
export async function listTemplatesImpl(supabase: SupabaseClient): Promise<ListTemplatesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query — ordered by template_key ASC
  const rows = await db
    .select({
      id: messageTemplates.id,
      templateKey: messageTemplates.templateKey,
      body: messageTemplates.body,
      variables: messageTemplates.variables,
      metaStatus: messageTemplates.metaStatus,
      isDefault: messageTemplates.isDefault,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.userId, user.id))
    .orderBy(asc(messageTemplates.templateKey));

  // 3. Truncate body for preview
  const templates: TemplatePreview[] = rows.map((row) => ({
    ...row,
    body:
      row.body.length > BODY_PREVIEW_LENGTH
        ? `${row.body.slice(0, BODY_PREVIEW_LENGTH)}...`
        : row.body,
  }));

  return { ok: true, templates };
}
