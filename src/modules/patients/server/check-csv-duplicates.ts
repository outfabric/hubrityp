import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { type DuplicateCandidate, checkDuplicatesInputSchema } from '../lib/csv-import-schema';

// ---------------------------------------------------------------------------
// Re-export the Zod-derived type so existing consumers keep working
// ---------------------------------------------------------------------------

export type { DuplicateCandidate };

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CheckCsvDuplicatesResult =
  | {
      ok: true;
      /** Phones that already exist for this psychologist (normalized format). */
      duplicatePhones: string[];
      /** Emails that already exist for this psychologist (lowercased). */
      duplicateEmails: string[];
    }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'validation_error'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Checks which phones and emails from a CSV import batch already exist for the
 * authenticated psychologist. Returns two arrays: one of duplicate phones and
 * one of duplicate emails, so the frontend can flag individual rows.
 *
 * This is a read-only operation — no data is mutated.
 */
export async function checkCsvDuplicatesImpl(
  supabase: SupabaseClient,
  candidates: unknown,
): Promise<CheckCsvDuplicatesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input via Zod (shape + cap at 200 candidates)
  const parsed = checkDuplicatesInputSchema.safeParse(candidates);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_error',
      message: 'Dados de verificação de duplicatas inválidos.',
    };
  }

  const validatedCandidates = parsed.data;
  const userId = user.id;

  try {
    // 3. Collect non-empty, unique phones and emails from the candidates
    const phonesToCheck = [
      ...new Set(
        validatedCandidates
          .map((c) => c.phone?.trim())
          .filter((p): p is string => p != null && p.length > 0),
      ),
    ];

    const emailsToCheck = [
      ...new Set(
        validatedCandidates
          .map((c) => c.email?.trim().toLowerCase())
          .filter((e): e is string => e != null && e.length > 0),
      ),
    ];

    // 4. Query for existing phones (scoped to this psychologist)
    let duplicatePhones: string[] = [];
    if (phonesToCheck.length > 0) {
      const rows = await db
        .select({ phone: patients.phone })
        .from(patients)
        .where(and(eq(patients.userId, userId), inArray(patients.phone, phonesToCheck)));

      duplicatePhones = rows.map((r) => r.phone).filter((p): p is string => p != null);
    }

    // 5. Query for existing emails (scoped to this psychologist)
    let duplicateEmails: string[] = [];
    if (emailsToCheck.length > 0) {
      const rows = await db
        .select({ email: patients.email })
        .from(patients)
        .where(and(eq(patients.userId, userId), inArray(patients.email, emailsToCheck)));

      duplicateEmails = rows.map((r) => r.email).filter((e): e is string => e != null);
    }

    return { ok: true, duplicatePhones, duplicateEmails };
  } catch {
    logger.error(
      { event: 'check_csv_duplicates_failed' },
      'unexpected error checking CSV duplicates',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro ao verificar duplicatas. Tente novamente.',
    };
  }
}
