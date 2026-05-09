import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of rows allowed in a single CSV import. */
const MAX_IMPORT_ROWS = 200;

// ---------------------------------------------------------------------------
// Input / Result types
// ---------------------------------------------------------------------------

/** A single validated patient row ready for insertion. */
export interface CsvPatientRow {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  tags?: string[];
  notes?: string | null;
}

export type ImportPatientsCsvResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'too_many_rows'; message: string }
  | { ok: false; error: 'empty'; message: string }
  | { ok: false; error: 'db_error'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Imports an array of validated patient rows for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate row count (1..200).
 *   3. Insert all rows in a single Drizzle transaction.
 *   4. On any error, the transaction rolls back automatically (no partial inserts).
 *
 * All imported patients are created with `patient_type = 'adult'` and
 * `status = 'active'` as defined in the spec.
 *
 * Callers are expected to have already run client-side validation (phone/email
 * format, required fields) and duplicate checking via `checkCsvDuplicatesImpl`
 * before calling this function. This function does NOT re-validate individual
 * fields — it trusts the pre-validated input.
 */
export async function importPatientsCsvImpl(
  supabase: SupabaseClient,
  rows: CsvPatientRow[],
): Promise<ImportPatientsCsvResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate row count
  if (rows.length === 0) {
    return {
      ok: false,
      error: 'empty',
      message: 'Nenhum paciente para importar.',
    };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: 'too_many_rows',
      message: `Máximo de ${MAX_IMPORT_ROWS} linhas por importação. Seu arquivo tem ${rows.length}.`,
    };
  }

  const userId = user.id;

  // 3. Build values for batch insert
  const values = rows.map((row) => ({
    userId,
    fullName: row.fullName,
    patientType: 'adult' as const,
    phone: row.phone?.trim() || null,
    email: row.email?.trim().toLowerCase() || null,
    birthDate: row.birthDate ? parseBirthDate(row.birthDate) : null,
    tags: row.tags ?? [],
    notes: row.notes?.trim() || null,
    status: 'active' as const,
  }));

  // 4. Insert in a transaction — automatic rollback on error
  try {
    await db.transaction(async (tx) => {
      await tx.insert(patients).values(values);
    });

    return { ok: true, importedCount: rows.length };
  } catch {
    logger.error(
      { event: 'import_patients_csv_failed' },
      'unexpected error during CSV patient import',
    );
    return {
      ok: false,
      error: 'db_error',
      message: 'Erro ao importar. Nenhum paciente foi criado. Tente novamente.',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a date string in DD/MM/YYYY or YYYY-MM-DD format into a Date object.
 * Returns null if the format is unrecognized.
 */
function parseBirthDate(value: string): Date | null {
  const trimmed = value.trim();

  // DD/MM/YYYY
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date;
    }
    return null;
  }

  // YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date;
    }
    return null;
  }

  return null;
}
