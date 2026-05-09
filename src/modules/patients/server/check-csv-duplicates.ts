import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input / Result types
// ---------------------------------------------------------------------------

/** A single candidate for duplicate checking — at least one of phone/email must be present. */
export interface DuplicateCandidate {
  phone?: string | null;
  email?: string | null;
}

export type CheckCsvDuplicatesResult =
  | {
      ok: true;
      /** Phones that already exist for this psychologist (normalized format). */
      duplicatePhones: string[];
      /** Emails that already exist for this psychologist (lowercased). */
      duplicateEmails: string[];
    }
  | { ok: false; error: 'unauthenticated' }
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
  candidates: DuplicateCandidate[],
): Promise<CheckCsvDuplicatesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    // 2. Collect non-empty, unique phones and emails from the candidates
    const phonesToCheck = [
      ...new Set(
        candidates
          .map((c) => c.phone?.trim())
          .filter((p): p is string => p != null && p.length > 0),
      ),
    ];

    const emailsToCheck = [
      ...new Set(
        candidates
          .map((c) => c.email?.trim().toLowerCase())
          .filter((e): e is string => e != null && e.length > 0),
      ),
    ];

    // 3. Query for existing phones (scoped to this psychologist)
    let duplicatePhones: string[] = [];
    if (phonesToCheck.length > 0) {
      const rows = await db
        .select({ phone: patients.phone })
        .from(patients)
        .where(and(eq(patients.userId, userId), inArray(patients.phone, phonesToCheck)));

      duplicatePhones = rows.map((r) => r.phone).filter((p): p is string => p != null);
    }

    // 4. Query for existing emails (scoped to this psychologist)
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
