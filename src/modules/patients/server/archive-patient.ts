import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ArchivePatientResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'already_archived' }
  | { ok: false; error: 'unknown'; message: string };

export type UnarchivePatientResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_archived' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// archivePatientImpl
// ---------------------------------------------------------------------------

/**
 * Archives a patient by setting status='archived' and archived_at=now().
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists, belongs to user, and is currently active.
 *   3. Set status='archived' and archived_at=now().
 *
 * Archived patients retain all data — this is a soft-delete that preserves
 * clinical records per CFP and LGPD retention requirements (20 years).
 */
export async function archivePatientImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<ArchivePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify patient exists and belongs to user
  const [existing] = await db
    .select({ id: patients.id, status: patients.status })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  if (existing.status === 'archived') {
    return { ok: false, error: 'already_archived' };
  }

  // 3. Archive
  try {
    await db
      .update(patients)
      .set({
        status: 'archived',
        archivedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'archive_patient_failed', errorCode: pgError.code },
      'unexpected error archiving patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao arquivar paciente. Tente novamente.',
    };
  }
}

// ---------------------------------------------------------------------------
// unarchivePatientImpl
// ---------------------------------------------------------------------------

/**
 * Unarchives a patient by setting status='active' and archived_at=null.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists, belongs to user, and is currently archived.
 *   3. Set status='active' and archived_at=null.
 */
export async function unarchivePatientImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<UnarchivePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify patient exists and belongs to user
  const [existing] = await db
    .select({ id: patients.id, status: patients.status })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  if (existing.status !== 'archived') {
    return { ok: false, error: 'not_archived' };
  }

  // 3. Unarchive
  try {
    await db
      .update(patients)
      .set({
        status: 'active',
        archivedAt: null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'unarchive_patient_failed', errorCode: pgError.code },
      'unexpected error unarchiving patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao desarquivar paciente. Tente novamente.',
    };
  }
}
