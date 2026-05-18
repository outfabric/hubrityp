import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  MAX_FILE_SIZE_BYTES,
  uploadAttachmentInputSchema,
} from '@/modules/medical-records/lib/attachment-schemas';
import {
  sanitizeDisplayName,
  generateStorageFilename,
} from '@/modules/medical-records/lib/filename-sanitizer';
import { validateMimeType } from '@/modules/medical-records/lib/mime-validator';
import { db } from '@/shared/db/client';
import { auditLog, evolutionAttachments } from '@/shared/db/schema/medical-records/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UploadAttachmentResult =
  | { ok: true; id: string; displayName: string }
  | {
      ok: false;
      code: 'FILE_TOO_LARGE' | 'INVALID_MIME' | 'CONSENT_REQUIRED' | 'UNAUTHORIZED' | 'NOT_FOUND';
    };

export interface AttachmentSummary {
  id: string;
  fileName: string;
  displayName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  uploadedAt: Date;
}

export type ListAttachmentsResult =
  | { ok: true; attachments: AttachmentSummary[] }
  | { ok: false; code: 'UNAUTHORIZED' };

export type GetAttachmentSignedUrlResult =
  | { ok: true; signedUrl: string; expiresIn: 300 }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' };

export type DeleteAttachmentResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Input schemas (private to this file)
// ---------------------------------------------------------------------------

const listAttachmentsInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  category: z.enum(['exam', 'image', 'drawing', 'audio', 'other']).optional(),
});

const getSignedUrlInputSchema = z.object({
  attachmentId: z.string().uuid({ message: 'attachmentId deve ser um UUID valido.' }),
});

const deleteAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid({ message: 'attachmentId deve ser um UUID valido.' }),
});

// ---------------------------------------------------------------------------
// uploadAttachment
// ---------------------------------------------------------------------------

/**
 * Uploads a file attachment to the patient's prontuario.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Extract and validate metadata from FormData (category via Zod).
 *   3. Check file size <= 50 MB (reject early before reading content).
 *   4. Read buffer and validate MIME via magic bytes.
 *   5. If category=audio, verify active consent exists.
 *   6. Verify patient ownership (defense-in-depth — db bypasses RLS).
 *   7. Generate UUID filename, upload to Storage.
 *   8. Persist evolution_attachments row.
 *   9. Write audit_log 'attachment.upload'.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 * Storage path follows convention: ${user_id}/${patient_id}/${uuid}.${ext}
 */
export async function uploadAttachmentImpl(
  supabase: SupabaseClient,
  patientId: unknown,
  formData: FormData,
): Promise<UploadAttachmentResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Extract metadata from FormData
  const file = formData.get('file');
  const categoryRaw = formData.get('category');

  if (!(file instanceof File)) {
    return { ok: false, code: 'INVALID_MIME' };
  }

  const metaParsed = uploadAttachmentInputSchema.safeParse({
    patientId,
    category: categoryRaw,
  });

  if (!metaParsed.success) {
    return { ok: false, code: 'INVALID_MIME' };
  }

  const { patientId: validatedPatientId, category } = metaParsed.data;

  // 3. Check file size (reject early before reading content)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }

  if (file.size === 0) {
    return { ok: false, code: 'INVALID_MIME' };
  }

  // 4. Read buffer and validate MIME via magic bytes
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeResult = await validateMimeType(buffer, category);

  if (!mimeResult.valid || !mimeResult.detectedMime || !mimeResult.detectedExt) {
    return { ok: false, code: 'INVALID_MIME' };
  }

  // 5. If category=audio, verify active consent
  let consentVerified = false;
  if (category === 'audio') {
    const hasConsent = await checkActiveConsent(userId, validatedPatientId);
    if (!hasConsent) {
      return { ok: false, code: 'CONSENT_REQUIRED' };
    }
    consentVerified = true;
  }

  // 6. Verify patient belongs to the authenticated user (defense-in-depth:
  // db bypasses RLS, so explicit ownership check prevents cross-tenant writes)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, validatedPatientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 7. Generate UUID filename and upload to Storage
  const storageFilename = generateStorageFilename(mimeResult.detectedExt);
  const storagePath = `${userId}/${validatedPatientId}/${storageFilename}`;
  const displayName = sanitizeDisplayName(file.name);

  const { error: uploadError } = await supabase.storage
    .from('patient-attachments')
    .upload(storagePath, buffer, {
      contentType: mimeResult.detectedMime,
      upsert: false,
    });

  if (uploadError) {
    logger.error(
      { event: 'attachment_upload_storage_failed' },
      'failed to upload attachment to storage',
    );
    throw new Error('Storage upload failed');
  }

  // 8. Persist evolution_attachments row + 9. Write audit_log
  try {
    const result = await db.transaction(async (tx) => {
      const [attachment] = await tx
        .insert(evolutionAttachments)
        .values({
          userId,
          patientId: validatedPatientId,
          fileName: storageFilename,
          displayName,
          fileSize: file.size,
          mimeType: mimeResult.detectedMime!,
          storagePath,
          category,
          consentVerified,
        })
        .returning({ id: evolutionAttachments.id });

      await tx.insert(auditLog).values({
        userId,
        action: 'attachment.upload',
        resourceType: 'attachment',
        resourceId: attachment!.id,
        metadata: { patientId: validatedPatientId, category, mimeType: mimeResult.detectedMime },
      });

      return { ok: true as const, id: attachment!.id, displayName };
    });

    return result;
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'attachment_upload_db_failed', errorCode: pgError.code },
      'unexpected error persisting attachment',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listAttachments
// ---------------------------------------------------------------------------

/**
 * Returns all non-soft-deleted attachments for a given patient,
 * ordered by uploaded_at DESC. Optionally filtered by category.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listAttachmentsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListAttachmentsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = listAttachmentsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: true, attachments: [] };
  }

  const { patientId, category } = parsed.data;

  // 3. Query with ownership + soft-delete filter (defense-in-depth: db
  // bypasses RLS, so we enforce userId explicitly)
  const conditions = [
    eq(evolutionAttachments.patientId, patientId),
    eq(evolutionAttachments.userId, userId),
    isNull(evolutionAttachments.deletedAt),
  ];

  if (category) {
    conditions.push(eq(evolutionAttachments.category, category));
  }

  const rows = await db
    .select({
      id: evolutionAttachments.id,
      fileName: evolutionAttachments.fileName,
      displayName: evolutionAttachments.displayName,
      fileSize: evolutionAttachments.fileSize,
      mimeType: evolutionAttachments.mimeType,
      category: evolutionAttachments.category,
      uploadedAt: evolutionAttachments.uploadedAt,
    })
    .from(evolutionAttachments)
    .where(and(...conditions))
    .orderBy(desc(evolutionAttachments.uploadedAt));

  return { ok: true, attachments: rows };
}

// ---------------------------------------------------------------------------
// getAttachmentSignedUrl
// ---------------------------------------------------------------------------

/**
 * Generates a 5-minute signed URL for downloading/previewing an attachment.
 *
 * Flow:
 *   1. Authenticate via getUser().
 *   2. Validate input.
 *   3. Verify ownership via direct query (defense-in-depth).
 *   4. Generate signed URL via Supabase Storage.
 *   5. Write audit_log 'attachment.view-url'.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getAttachmentSignedUrlImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetAttachmentSignedUrlResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = getSignedUrlInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { attachmentId } = parsed.data;

  // 3. Verify ownership (defense-in-depth: db bypasses RLS)
  const [attachment] = await db
    .select({
      id: evolutionAttachments.id,
      storagePath: evolutionAttachments.storagePath,
    })
    .from(evolutionAttachments)
    .where(and(eq(evolutionAttachments.id, attachmentId), eq(evolutionAttachments.userId, userId)))
    .limit(1);

  if (!attachment) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Generate signed URL
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('patient-attachments')
    .createSignedUrl(attachment.storagePath, 300);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error({ event: 'attachment_signed_url_failed' }, 'failed to generate signed URL');
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 5. Write audit_log (fire-and-forget)
  try {
    await db.insert(auditLog).values({
      userId,
      action: 'attachment.view-url',
      resourceType: 'attachment',
      resourceId: attachmentId,
      metadata: {},
    });
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'attachment_audit_view_url_failed', errorCode: pgError.code },
      'failed to write audit_log for view-url',
    );
  }

  return { ok: true, signedUrl: signedUrlData.signedUrl, expiresIn: 300 };
}

// ---------------------------------------------------------------------------
// deleteAttachment
// ---------------------------------------------------------------------------

/**
 * Soft-deletes an attachment by setting `deleted_at = now()`.
 *
 * The Storage object is NOT physically deleted — Lei 13.787/2018 mandates
 * 20-year retention. A future Inngest cron handles physical deletion.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function deleteAttachmentImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<DeleteAttachmentResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = deleteAttachmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { attachmentId } = parsed.data;

  // 3. Verify ownership and set deleted_at (defense-in-depth: db bypasses RLS)
  try {
    const result = await db.transaction(async (tx) => {
      const [attachment] = await tx
        .select({ id: evolutionAttachments.id })
        .from(evolutionAttachments)
        .where(
          and(
            eq(evolutionAttachments.id, attachmentId),
            eq(evolutionAttachments.userId, userId),
            isNull(evolutionAttachments.deletedAt),
          ),
        )
        .limit(1);

      if (!attachment) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }

      await tx
        .update(evolutionAttachments)
        .set({ deletedAt: new Date() })
        .where(eq(evolutionAttachments.id, attachmentId));

      await tx.insert(auditLog).values({
        userId,
        action: 'attachment.delete',
        resourceType: 'attachment',
        resourceId: attachmentId,
        metadata: {},
      });

      return { ok: true as const };
    });

    return result;
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'attachment_delete_failed', errorCode: pgError.code },
      'unexpected error deleting attachment',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal: check active consent for audio uploads
// ---------------------------------------------------------------------------

/**
 * Checks if the patient has an active (signed, not revoked) consent term
 * belonging to the authenticated psychologist.
 *
 * See design.md Decision #7 — any active consent satisfies RN-05.07 (CFP 13/2022).
 * Query: signed_at IS NOT NULL AND revoked_at IS NULL AND user_id = :uid AND patient_id = :pid
 */
async function checkActiveConsent(userId: string, patientId: string): Promise<boolean> {
  const [consent] = await db
    .select({ id: consentTerms.id })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.patientId, patientId),
        eq(consentTerms.userId, userId),
        isNotNull(consentTerms.signedAt),
        isNull(consentTerms.revokedAt),
      ),
    )
    .limit(1);

  return !!consent;
}
