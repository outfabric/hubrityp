'use server';

// Thin route shell for template-edit Server Actions.
//
// The actual implementations live in `src/modules/whatsapp/server/` and are
// re-exported from `@/modules/whatsapp`. This file carries `'use server'` so
// Next.js treats every export as a Server Action entry point.

import type {
  GetTemplateMetaStatusResult,
  GetTemplateResult,
  UpdateTemplateResult,
} from '@/modules/whatsapp';
import { getTemplateImpl, getTemplateMetaStatusImpl, updateTemplateImpl } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function getTemplate(templateKey: string): Promise<GetTemplateResult> {
  const supabase = await createServerClient();
  return getTemplateImpl(supabase, templateKey);
}

export async function updateTemplate(input: unknown): Promise<UpdateTemplateResult> {
  const supabase = await createServerClient();
  return updateTemplateImpl(supabase, input);
}

export async function getTemplateMetaStatus(
  templateKey: string,
): Promise<GetTemplateMetaStatusResult> {
  const supabase = await createServerClient();
  return getTemplateMetaStatusImpl(supabase, templateKey);
}
