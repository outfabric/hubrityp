import { z } from 'zod';

import { TranscriptionIdSchema, type TranscriptionId } from './branded-types';
import {
  GeneratedNoteSchema,
  RiskAlertSchema,
  type GeneratedNote,
  type RiskAlert,
  type TranscriptionSource,
  type TranscriptionStatus,
} from './schemas';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * Input for `getTranscriptionForReview`.
 *
 * `transcriptionId` is the only client-supplied value; ownership is enforced
 * server-side (the caller's `user_id` comes from the session, never input).
 */
export const GetTranscriptionForReviewInputSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
});
export type GetTranscriptionForReviewInput = z.infer<typeof GetTranscriptionForReviewInputSchema>;

/**
 * Input for `updateTranscriptionDraft`.
 *
 * `generatedNote` is parsed by the canonical `GeneratedNoteSchema` so a
 * malformed payload is rejected at the boundary before touching the DB.
 */
export const UpdateTranscriptionDraftInputSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
  generatedNote: GeneratedNoteSchema,
});
export type UpdateTranscriptionDraftInput = z.infer<typeof UpdateTranscriptionDraftInputSchema>;

/**
 * Input for `saveTranscriptionToProntuario`.
 *
 * `reviewedChecked` is a Zod literal `true`: the psychologist MUST have ticked
 * the "I reviewed this note" checkbox. Any other value fails parsing and the
 * action returns `MUST_REVIEW` without performing a single DB write (RF-10.15
 * — clinical responsibility stays with the human).
 */
export const SaveTranscriptionToProntuarioInputSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
  reviewedChecked: z.literal(true),
});
export type SaveTranscriptionToProntuarioInput = z.infer<
  typeof SaveTranscriptionToProntuarioInputSchema
>;

/**
 * Input for `discardTranscription`.
 */
export const DiscardTranscriptionInputSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
});
export type DiscardTranscriptionInput = z.infer<typeof DiscardTranscriptionInputSchema>;

// ---------------------------------------------------------------------------
// Output discriminated unions
// ---------------------------------------------------------------------------

/**
 * Success payload of `getTranscriptionForReview`.
 *
 * `generatedNote` is `null` when the stored JSONB drifts from the current
 * schema (the UI then degrades to a "regenerate" state instead of rendering
 * a half-broken form). `riskAlerts` is `[]` when absent or on drift.
 */
export interface TranscriptionForReview {
  transcriptionId: TranscriptionId;
  status: TranscriptionStatus;
  source: TranscriptionSource;
  templateUsed: string | null;
  patientFirstName: string;
  patientId: string;
  sessionId: string | null;
  sessionDate: Date | null;
  generatedNote: GeneratedNote | null;
  riskAlerts: RiskAlert[];
  savedToProntuario: boolean;
  evolutionId: string | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type GetTranscriptionForReviewResult =
  | ({ ok: true } & TranscriptionForReview)
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'NOT_FOUND' };

export type UpdateTranscriptionDraftResult =
  | { ok: true; savedAt: Date }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'NOT_EDITABLE' };

export type SaveTranscriptionToProntuarioResult =
  | { ok: true; evolutionId: string }
  | {
      ok: false;
      code: 'UNAUTHORIZED' | 'MUST_REVIEW' | 'NOT_FOUND' | 'ALREADY_SAVED' | 'SAVE_FAILED';
    };

export type DiscardTranscriptionResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'NOT_FOUND' | 'ALREADY_REVIEWED' };

// Re-export the JSONB content schemas used for drift detection so the server
// implementations import everything review-related from this single module.
export { GeneratedNoteSchema, RiskAlertSchema };
