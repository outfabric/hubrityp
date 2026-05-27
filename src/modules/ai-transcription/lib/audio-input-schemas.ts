import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/**
 * Validates a patient UUID. Reuses the same pattern as the patients module's
 * `PatientIdSchema` — a standalone copy here avoids a circular dependency
 * from `ai-transcription → patients`.
 */
export const PatientIdSchema = z.string().uuid();

/**
 * Session ID — nullable because manual uploads can happen outside a
 * scheduled session.
 */
export const SessionIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Content type allowlist
// ---------------------------------------------------------------------------

/**
 * The exact set of declared content types the platform accepts for audio
 * uploads. This list MUST stay in sync with the MIME validator in
 * `server/validators/mime.ts`.
 */
export const ALLOWED_AUDIO_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
] as const;

export type AllowedAudioContentType = (typeof ALLOWED_AUDIO_CONTENT_TYPES)[number];

/**
 * Maps each allowed content type to the file extension used in the Storage
 * object key. The key uses UUIDs and this extension — no PII.
 */
export const CONTENT_TYPE_TO_EXT: Record<AllowedAudioContentType, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-m4a': 'm4a',
};

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for `requestAudioUploadUrl` input.
 *
 * - `patientId`: required, must be a valid UUID.
 * - `sessionId`: nullable — manual uploads can happen outside a session.
 * - `contentType`: must be one of the allowed audio MIME types.
 * - `sizeBytes`: declared file size, validated as a positive integer.
 */
export const RequestAudioUploadUrlInputSchema = z.object({
  patientId: PatientIdSchema,
  sessionId: SessionIdSchema.nullable(),
  contentType: z.enum(ALLOWED_AUDIO_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
});

export type RequestAudioUploadUrlInput = z.infer<typeof RequestAudioUploadUrlInputSchema>;

// ---------------------------------------------------------------------------
// Confirm input schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for `confirmAudioUpload` input.
 *
 * - `transcriptionId`: required, must be a valid UUID.
 * - `audioDurationSeconds`: nullable — best-effort duration from client;
 *   validated as a non-negative integer when provided.
 */
export const ConfirmAudioUploadInputSchema = z.object({
  transcriptionId: z.string().uuid(),
  audioDurationSeconds: z.number().int().nonnegative().nullable(),
});

export type ConfirmAudioUploadInput = z.infer<typeof ConfirmAudioUploadInputSchema>;
