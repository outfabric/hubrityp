'use server';

// Server Action for updating an evolution — colocated at route level
// so that deep _components/ can receive it as a prop without restricted
// relative imports.

import type { UpdateEvolutionResult } from '@/modules/medical-records';
import { updateEvolutionImpl } from '@/modules/medical-records';
import { createServerClient } from '@/shared/supabase/server';

export async function updateEvolution(input: unknown): Promise<UpdateEvolutionResult> {
  const supabase = await createServerClient();
  return updateEvolutionImpl(supabase, input);
}
