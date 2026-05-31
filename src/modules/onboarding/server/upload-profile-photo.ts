import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Private Storage bucket for onboarding profile photos. Objects are keyed under
 * an owner-scoped prefix (`<auth.uid()>/<uuid>.<ext>`) and the bucket RLS
 * policies (migration 0035) restrict every operation to the owning user.
 */
const BUCKET = 'onboarding-profile-photos';

/** Max accepted photo size — 5 MB. Validated SERVER-side; never trust the client. */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Allowlist of accepted image MIME types, each mapped to the canonical
 * extension we use for the SERVER-generated object name. The user-supplied
 * filename and its extension are NEVER used — we derive the extension purely
 * from the validated MIME type, closing path-traversal / spoofed-extension
 * vectors.
 */
const MIME_TO_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const satisfies Record<string, string>;

type AllowedMime = keyof typeof MIME_TO_EXTENSION;

function isAllowedMime(mime: string): mime is AllowedMime {
  return Object.prototype.hasOwnProperty.call(MIME_TO_EXTENSION, mime);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Sanitized result. On failure the caller receives a stable `error` code plus a
 * human pt-BR message — never a Postgres / Storage internal message or stack
 * trace. The success case returns only the owner-scoped object key (no signed
 * URL); the UI resolves a short-lived signed URL separately when it needs to
 * render the photo.
 */
export type UploadProfilePhotoResult =
  | { ok: true; objectKey: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'no_file'; message: string }
  | { ok: false; error: 'invalid_file_type'; message: string }
  | { ok: false; error: 'file_too_large'; message: string }
  | { ok: false; error: 'storage_error'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Uploads the authenticated psychologist's onboarding profile photo.
 *
 * Server-authoritative throughout:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()`).
 *   2. Extract the file from `FormData` and validate MIME, size, and the
 *      derived extension SERVER-side — client validation is treated as
 *      advisory only.
 *   3. Upload to the private `onboarding-profile-photos` bucket under a
 *      SERVER-generated UUID filename in the owner-scoped prefix
 *      `<userId>/<uuid>.<ext>`. The user-supplied filename is discarded.
 *
 * The owner-scoped object key is returned to the caller; no `profiles` column
 * is written here (the photo is addressed purely by its Storage key under the
 * owner prefix). Authorization is `auth.uid()` only — there is no
 * client-supplied user/owner id to trust, so there is no IDOR surface. Errors
 * are sanitized and no PII is logged (we log the internal user UUID and a code,
 * never the filename, MIME, or raw content).
 */
export async function uploadProfilePhotoImpl(
  supabase: SupabaseClient,
  formData: FormData,
): Promise<UploadProfilePhotoResult> {
  // 1. Authenticate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Extract + validate the file SERVER-side.
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'no_file', message: 'Nenhum arquivo enviado.' };
  }

  if (!isAllowedMime(file.type)) {
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
      message: 'A foto deve ter no máximo 5MB.',
    };
  }

  // 3. SERVER-generated object name. The extension comes from the validated
  // MIME type, NOT from the user-supplied filename.
  const extension = MIME_TO_EXTENSION[file.type];
  const objectKey = `${userId}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectKey, file, {
    // A fresh UUID name per upload means there is nothing to overwrite; keep
    // upsert off so a (vanishingly unlikely) collision surfaces as an error
    // rather than silently clobbering another object.
    upsert: false,
    contentType: file.type,
  });

  if (uploadError) {
    logger.error(
      { event: 'upload_profile_photo_storage_failed', userId, storageError: uploadError.message },
      'failed to upload onboarding profile photo to storage',
    );
    return {
      ok: false,
      error: 'storage_error',
      message: 'Erro ao enviar a foto. Tente novamente.',
    };
  }

  return { ok: true, objectKey };
}
