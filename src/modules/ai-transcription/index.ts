// Public API of the `ai-transcription` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/ai-transcription`,
// never from internal paths like `@/modules/ai-transcription/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports schemas, pure helpers, the domain logger, and
// (future) Server Action implementations. The `'use server'` directives will
// live on the route shells under `src/app/` which import from this barrel and
// re-export as bona fide Server Actions.

// ---- Branded types ----------------------------------------------------------
export { TranscriptionIdSchema, type TranscriptionId } from './lib/branded-types';

// ---- Zod schemas / enums ----------------------------------------------------
export {
  TranscriptionStatusSchema,
  type TranscriptionStatus,
  TranscriptionSourceSchema,
  type TranscriptionSource,
  TranscriptionTemplateSchema,
  type TranscriptionTemplate,
  RiskSensitivitySchema,
  type RiskSensitivity,
  GeneratedNoteSchema,
  type GeneratedNote,
  RiskAlertSchema,
  type RiskAlert,
  AiConsentTemplateSchema,
  ConsentTemplateSectionSchema,
  type AiConsentTemplateSnapshot,
} from './lib/schemas';

// ---- Consent template -------------------------------------------------------
export {
  AI_CONSENT_TEMPLATE_V1,
  type AiConsentTemplate,
  type ConsentTemplateSection,
} from './lib/consent-template';

// ---- Pure helpers -----------------------------------------------------------
export { pseudonymizeTranscript } from './lib/pseudonymize';

// ---- Consent helper ---------------------------------------------------------
export { assertAiConsentActive, type AssertAiConsentResult } from './lib/consent';
export type { AssertAiConsentDeps } from './lib/consent';

// ---- Pricing ----------------------------------------------------------------
export { PRICING_VERSION, MODEL_PRICING, computeCost } from './lib/pricing';

// ---- Logger -----------------------------------------------------------------
export { createTranscriptionLogger } from './lib/logger';

// ---- Audio input schemas ----------------------------------------------------
export {
  RequestAudioUploadUrlInputSchema,
  type RequestAudioUploadUrlInput,
  ConfirmAudioUploadInputSchema,
  type ConfirmAudioUploadInput,
  ALLOWED_AUDIO_CONTENT_TYPES,
  type AllowedAudioContentType,
  CONTENT_TYPE_TO_EXT,
  PatientIdSchema as AudioPatientIdSchema,
  SessionIdSchema as AudioSessionIdSchema,
} from './lib/audio-input-schemas';

// ---- Review schemas / types -------------------------------------------------
export {
  GetTranscriptionForReviewInputSchema,
  type GetTranscriptionForReviewInput,
  UpdateTranscriptionDraftInputSchema,
  type UpdateTranscriptionDraftInput,
  SaveTranscriptionToProntuarioInputSchema,
  type SaveTranscriptionToProntuarioInput,
  DiscardTranscriptionInputSchema,
  type DiscardTranscriptionInput,
  type GetTranscriptionForReviewResult,
  type UpdateTranscriptionDraftResult,
  type SaveTranscriptionToProntuarioResult,
  type DiscardTranscriptionResult,
  type TranscriptionForReview,
} from './lib/review-schemas';

// ---- Note serializer --------------------------------------------------------
export { serializeNoteAsEvolution } from './lib/serialize-note';

// ---- Server -----------------------------------------------------------------
export { requestAudioUploadUrlImpl, type RequestAudioUploadUrlResult } from './server';
export { confirmAudioUploadImpl, type ConfirmAudioUploadResult } from './server';
export { getTranscriptionForReviewImpl } from './server';
export { updateTranscriptionDraftImpl } from './server';
export { saveTranscriptionToProntuarioImpl } from './server';
export { discardTranscriptionImpl } from './server';
