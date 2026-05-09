import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { type CsvPatientRow, importCsvInputSchema } from '../lib/csv-import-schema';

// ---------------------------------------------------------------------------
// Re-export the Zod-derived type so existing consumers keep working
// ---------------------------------------------------------------------------

export type { CsvPatientRow };

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ImportPatientsCsvResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'validation_error'; message: string }
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
 * before calling this function, but this function re-validates via Zod as a
 * defense-in-depth measure against crafted requests.
 */
export async function importPatientsCsvImpl(
  supabase: SupabaseClient,
  rows: unknown,
): Promise<ImportPatientsCsvResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input via Zod (shape, bounds, and row count: 1..200)
  const parsed = importCsvInputSchema.safeParse(rows);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_error',
      message: 'Dados de importação inválidos. Verifique o formato e o limite de 200 linhas.',
    };
  }

  const validatedRows = parsed.data;
  const userId = user.id;

  // 3. Build values for batch insert
  const values = validatedRows.map((row) => ({
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

    return { ok: true, importedCount: validatedRows.length };
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
