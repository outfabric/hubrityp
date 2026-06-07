import { z } from 'zod';

// ---------------------------------------------------------------------------
// Attachment category enum
// ---------------------------------------------------------------------------

const ATTACHMENT_CATEGORIES = ['exam', 'image', 'drawing', 'audio', 'other'] as const;

export const attachmentCategorySchema = z.enum(ATTACHMENT_CATEGORIES, {
  message: 'Categoria deve ser exam, image, drawing, audio ou other.',
});

export type AttachmentCategory = z.infer<typeof attachmentCategorySchema>;

// ---------------------------------------------------------------------------
// MIME allowlists per category (used by mime-validator and server actions)
// ---------------------------------------------------------------------------

export const MIME_ALLOWLIST: Record<AttachmentCategory, readonly string[]> = {
  exam: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  drawing: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav'],
  other: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;

// ---------------------------------------------------------------------------
// File size limit (50 MB)
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (50 MB). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Upload input schema
// ---------------------------------------------------------------------------

/**
 * Input for uploading an attachment.
 *
 * The actual file comes via FormData (not in the Zod schema). This schema
 * validates the structured metadata that accompanies the upload.
 * `patientId` is validated here but MUST be cross-checked against session
 * ownership server-side (never trusted from client alone).
 */
export const uploadAttachmentInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  category: attachmentCategorySchema,
});

export type UploadAttachmentInput = z.infer<typeof uploadAttachmentInputSchema>;
