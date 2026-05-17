'use server';

// Server Action for creating a new evolution — colocated at route level
// so that deep _components/ can receive it as a prop without restricted
// relative imports.

import type { CreateEvolutionResult } from '@/modules/medical-records';
import { createEvolutionImpl } from '@/modules/medical-records';
import { createServerClient } from '@/shared/supabase/server';

export async function createEvolution(input: unknown): Promise<CreateEvolutionResult> {
  const supabase = await createServerClient();
  return createEvolutionImpl(supabase, input);
}
