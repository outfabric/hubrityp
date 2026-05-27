/**
 * Inngest event payload schemas for the ai-transcription module.
 *
 * Each schema is the single source of truth for the shape of the
 * corresponding Inngest event payload. Server Actions validate outbound
 * payloads before sending, and Inngest functions validate inbound
 * payloads on receipt.
 */

import { z } from 'zod';

import { TranscriptionIdSchema } from '../lib/branded-types';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const uuidField = z.string().uuid();

// ---------------------------------------------------------------------------
// Event schemas
// ---------------------------------------------------------------------------

/**
 * `ai-transcription/consent.revoked` — a patient's AI consent is revoked.
 *
 * Emitted fire-and-forget by the `revokeAiConsentTermImpl` Server Action.
 * Downstream consumers (stub for now) can use this to clean up any
 * pending transcription jobs for the patient.
 */
export const consentRevokedEventSchema = z.object({
  termId: uuidField,
  userId: uuidField,
  patientId: uuidField,
  revokedAt: z.coerce.date(),
  reason: z.string().max(500).nullable(),
});
export type ConsentRevokedEvent = z.infer<typeof consentRevokedEventSchema>;

/**
 * `ai-transcription/audio.uploaded` — audio is validated and ready for processing.
 *
 * Emitted fire-and-forget by `confirmAudioUploadImpl` (manual upload path)
 * and by `ingestStreamRecording` (video session path). Downstream consumers
 * (stub for now, real processor in `ai-transcription-gemini-processing`)
 * transition the row to `transcribing` and kick off the Gemini pipeline.
 */
export const audioUploadedEventSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
  userId: uuidField,
  patientId: uuidField,
  source: z.enum(['manual_upload', 'video_session']),
});
export type AudioUploadedEvent = z.infer<typeof audioUploadedEventSchema>;

/**
 * `ai-transcription/recording.completed` — a Stream video recording is ready.
 *
 * Emitted by the telepsicologia webhook handler when a call recording
 * finishes. The `ingestStreamRecording` Inngest function consumes this
 * event, downloads the recording from `streamRecordingUrl`, uploads it to
 * Supabase Storage, creates a transcription row, and fires
 * `ai-transcription/audio.uploaded` to start the Gemini pipeline.
 */
export const recordingCompletedEventSchema = z.object({
  userId: uuidField,
  patientId: uuidField,
  sessionId: uuidField.nullable(),
  streamRecordingUrl: z.string().url(),
  streamCallId: z.string().min(1),
});
export type RecordingCompletedEvent = z.infer<typeof recordingCompletedEventSchema>;

export const AI_TRANSCRIPTION_EVENTS = {
  CONSENT_REVOKED: 'ai-transcription/consent.revoked',
  AUDIO_UPLOADED: 'ai-transcription/audio.uploaded',
  RECORDING_COMPLETED: 'ai-transcription/recording.completed',
} as const;
