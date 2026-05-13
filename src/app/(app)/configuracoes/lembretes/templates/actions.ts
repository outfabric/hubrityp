'use server';

// Thin route shell for template-listing Server Actions.
//
// The actual implementation lives in `src/modules/whatsapp/server/list-templates.ts`
// (re-exported from `@/modules/whatsapp`). This file carries `'use server'` so
// Next.js treats every export as a Server Action entry point.

import type { ListTemplatesResult } from '@/modules/whatsapp';
import { listTemplatesImpl } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function listTemplates(): Promise<ListTemplatesResult> {
  const supabase = await createServerClient();
  return listTemplatesImpl(supabase);
}
