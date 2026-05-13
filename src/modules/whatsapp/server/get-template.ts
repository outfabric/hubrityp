import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import type { MessageTemplate } from '@/shared/db/schema/whatsapp/tables';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';

import { templateKeySchema } from '../lib/template-key-schema';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetTemplateResult =
  | { ok: true; template: MessageTemplate }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves a single message template by `template_key` for the
 * authenticated psychologist. Returns the full template row (no truncation).
 */
export async function getTemplateImpl(
  supabase: SupabaseClient,
  templateKey: string,
): Promise<GetTemplateResult> {
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

  // 3. Query
  const [row] = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.userId, user.id), eq(messageTemplates.templateKey, parsed.data)))
    .limit(1);

  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  return { ok: true, template: row };
}
