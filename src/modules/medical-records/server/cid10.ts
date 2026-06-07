import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { type Cid10Result, searchCid10 } from '@/modules/medical-records/lib/cid10-search';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const searchCid10Schema = z.object({
  query: z.string().max(100, { message: 'Consulta deve ter no máximo 100 caracteres.' }),
  limit: z.number().int().min(1).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SearchCid10Result =
  | { ok: true; results: Cid10Result[] }
  | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Searches the CID-10 static dataset for matching codes/descriptions.
 *
 * Authentication is required (CID-10 data is public but access must be
 * authenticated to prevent anonymous scraping and ensure audit-ability).
 * No audit log is written for CID-10 searches as this is reference data,
 * not patient clinical data.
 *
 * The search function runs entirely in-process (sub-ms) against a static
 * JSON file loaded at module initialization — no DB round-trip.
 */
export async function searchCid10Impl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SearchCid10Result> {
  // 1. Authenticate — reject unauthenticated calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = searchCid10Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { query, limit } = parsed.data;

  // 3. Execute in-memory search (no DB call needed)
  const results = searchCid10(query, limit);

  return { ok: true, results };
}
