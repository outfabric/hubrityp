import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UploadPatientPhotoResult =
  | { ok: true; photoPath: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_file_type'; message: string }
  | { ok: false; error: 'file_too_large'; message: string }
  | { ok: false; error: 'no_file'; message: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'storage_error'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Uploads a patient photo to Supabase Storage and updates patient.photo_path.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Extract file from FormData and validate type + size.
 *   3. Verify patient exists and belongs to user.
 *   4. Upload file to bucket `patient-photos` at path `{user_id}/{patient_id}.{ext}`.
 *   5. Update patient.photo_path in the database.
 *
 * The storage path convention ensures one photo per patient (overwrite on re-upload).
 */
export async function uploadPatientPhotoImpl(
  supabase: SupabaseClient,
  patientId: string,
  formData: FormData,
): Promise<UploadPatientPhotoResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Extract and validate file
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return { ok: false, error: 'no_file', message: 'Nenhum arquivo enviado.' };
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: 'invalid_file_type',
      message: 'Formato não suportado. Use JPEG, PNG ou WebP.',
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: 'file_too_large',
      message: 'Foto deve ter no máximo 2MB.',
    };
  }

  const userId = user.id;

  // 3. Verify patient exists and belongs to user
  const [existing] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. Upload to Supabase Storage
  const extension = MIME_TO_EXTENSION[file.type]!;
  const storagePath = `${userId}/${patientId}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('patient-photos')
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    logger.error(
      { event: 'upload_patient_photo_failed', storageError: uploadError.message },
      'failed to upload patient photo to storage',
    );
    return {
      ok: false,
      error: 'storage_error',
      message: 'Erro ao fazer upload da foto. Tente novamente.',
    };
  }

  // 5. Update patient.photo_path in the database
  try {
    await db
      .update(patients)
      .set({ photoPath: storagePath, updatedAt: sql`now()` })
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    return { ok: true, photoPath: storagePath };
  } catch (err: unknown) {
    logger.error(
      { event: 'update_patient_photo_path_failed', errorCode: (err as { code?: string }).code },
      'unexpected error updating patient photo_path',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao salvar foto. Tente novamente.',
    };
  }
}
