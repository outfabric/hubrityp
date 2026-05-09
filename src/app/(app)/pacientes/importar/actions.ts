'use server';

// Thin route shell for CSV import Server Actions.
//
// Actual implementations live in `src/modules/patients/server/`.
// This file carries `'use server'` to mark exports as Server Action
// entry points for the Next.js compiler. Every export MUST be an
// async function.

import type { CheckCsvDuplicatesResult, DuplicateCandidate } from '@/modules/patients';
import type { ImportPatientsCsvResult, CsvPatientRow } from '@/modules/patients';
import { checkCsvDuplicatesImpl, importPatientsCsvImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

export async function checkCsvDuplicates(
  candidates: DuplicateCandidate[],
): Promise<CheckCsvDuplicatesResult> {
  const supabase = await createServerClient();
  return checkCsvDuplicatesImpl(supabase, candidates);
}

export async function importPatientsCsv(rows: CsvPatientRow[]): Promise<ImportPatientsCsvResult> {
  const supabase = await createServerClient();
  return importPatientsCsvImpl(supabase, rows);
}
