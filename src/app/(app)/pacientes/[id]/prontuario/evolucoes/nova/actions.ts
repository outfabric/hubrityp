'use server';

// Server Action for creating a new evolution — colocated at route level
// so that deep _components/ can receive it as a prop without restricted
// relative imports.

import { revalidatePath } from 'next/cache';

import type { CreateEvolutionResult } from '@/modules/medical-records';
import { createEvolutionImpl } from '@/modules/medical-records';
import { createServerClient } from '@/shared/supabase/server';

export async function createEvolution(input: unknown): Promise<CreateEvolutionResult> {
  const supabase = await createServerClient();
  const result = await createEvolutionImpl(supabase, input);

  if (result.ok) {
    // Creating an evolution resolves an agenda pendência; invalidate the
    // router-cache entry for /agenda so the overdue list re-queries fresh on
    // return — resolved row gone, count N−1 (design D5, RF-12.10).
    revalidatePath('/agenda');
  }

  return result;
}
