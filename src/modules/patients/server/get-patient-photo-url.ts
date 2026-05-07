import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Signed URL expiration in seconds (5 minutes). */
const SIGNED_URL_EXPIRY_SECONDS = 300;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetPatientPhotoUrlResult =
  | { ok: true; signedUrl: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'no_photo' }
  | { ok: false; error: 'storage_error'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a signed URL (5min expiration) for a patient's photo.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Fetch patient (verify ownership) and check photo_path is set.
 *   3. Generate signed URL from Supabase Storage.
 */
export async function getPatientPhotoUrlImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetPatientPhotoUrlResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Fetch patient and verify ownership
  const [row] = await db
    .select({ id: patients.id, photoPath: patients.photoPath })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  if (!row.photoPath) {
    return { ok: false, error: 'no_photo' };
  }

  // 3. Generate signed URL
  const { data, error } = await supabase.storage
    .from('patient-photos')
    .createSignedUrl(row.photoPath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    logger.error(
      { event: 'get_patient_photo_url_failed', storageError: error?.message },
      'failed to create signed URL for patient photo',
    );
    return {
      ok: false,
      error: 'storage_error',
      message: 'Erro ao gerar URL da foto. Tente novamente.',
    };
  }

  return { ok: true, signedUrl: data.signedUrl };
}
