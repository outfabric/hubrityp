// Public API of the `medical-records` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/medical-records`,
// never from internal paths like `@/modules/medical-records/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// types, and Zod schemas; if it carried `'use server'`, every export would be
// transformed into an RPC stub by the Next.js compiler.

// ---- Server Actions (delegated to by route shells) --------------------------
export { createEvolutionImpl, type CreateEvolutionResult } from './server/create-evolution';
export { updateEvolutionImpl, type UpdateEvolutionResult } from './server/update-evolution';
export {
  getEvolutionsByPatientImpl,
  type GetEvolutionsByPatientResult,
  type EvolutionSummary,
} from './server/get-evolutions-by-patient';
export {
  getEvolutionDetailImpl,
  type GetEvolutionDetailResult,
  type EvolutionFull,
} from './server/get-evolution-detail';
export {
  listEvolutionVersionsImpl,
  type ListEvolutionVersionsResult,
} from './server/list-evolution-versions';
export { logProntuarioAccessImpl } from './server/log-prontuario-access';

// ---- Zod Schemas ------------------------------------------------------------
export {
  createEvolutionInputSchema,
  updateEvolutionInputSchema,
  CONTENT_SCHEMA_MAP,
  tccContentSchema,
  psicanaliseContentSchema,
  sistemicaContentSchema,
  abaContentSchema,
  livreContentSchema,
  customContentSchema,
  type CreateEvolutionInput,
  type UpdateEvolutionInput,
} from './lib/evolution-schemas';

// ---- Template Types ---------------------------------------------------------
export { TEMPLATE_TYPES, TEMPLATE_OPTIONS, type TemplateType } from './lib/template-types';

// ---- Immutability Helpers ---------------------------------------------------
export { isWithinEditWindow, shouldForceAddendum } from './lib/immutability-helpers';

// ---- Content Diff -----------------------------------------------------------
export { contentHasChanged } from './lib/content-diff';

// ---- Hypothesis Server Actions -----------------------------------------------
export {
  createHypothesisImpl,
  updateHypothesisImpl,
  updateHypothesisStatusImpl,
  listHypothesesByPatientImpl,
  type CreateHypothesisResult,
  type UpdateHypothesisResult,
  type UpdateHypothesisStatusResult,
  type ListHypothesesResult,
  type HypothesisSummary,
} from './server/hypotheses';

// ---- CID-10 Search ----------------------------------------------------------
export { searchCid10Impl, type SearchCid10Result } from './server/cid10';

// ---- CID-10 Lib (re-export for direct use in tests/components) ---------------
export { searchCid10, type Cid10Result } from './lib/cid10-search';

// ---- Hypothesis Schemas -----------------------------------------------------
export {
  hypothesisStatusSchema,
  createHypothesisSchema,
  updateHypothesisSchema,
  updateHypothesisStatusSchema,
  type HypothesisStatus,
  type CreateHypothesisInput,
  type UpdateHypothesisInput,
  type UpdateHypothesisStatusInput,
} from './lib/schemas/hypothesis';

// ---- Treatment Plan Server Actions ------------------------------------------
export {
  upsertTreatmentPlanImpl,
  getTreatmentPlanImpl,
  listTreatmentPlanVersionsImpl,
  type UpsertTreatmentPlanResult,
  type GetTreatmentPlanResult,
  type ListTreatmentPlanVersionsResult,
} from './server/treatment-plans';

// ---- Treatment Plan Schemas -------------------------------------------------
export {
  goalSchema,
  phaseSchema,
  upsertTreatmentPlanInputSchema,
  getTreatmentPlanInputSchema,
  listTreatmentPlanVersionsInputSchema,
  versionContentSchema,
  type Goal,
  type Phase,
  type TreatmentPlanInput,
  type VersionContent,
} from './lib/treatment-plan-schemas';

// ---- Scale Application Server Actions ---------------------------------------
export {
  createScaleApplicationImpl,
  submitScaleResponsesImpl,
  getScaleHistory,
  listScalesForPatient,
  type CreateScaleApplicationResult,
  type SubmitScaleResponsesResult,
  type GetScaleHistoryResult,
  type ListScalesForPatientResult,
  type ScaleApplicationSummary,
  type ScaleSummary,
  type TimeseriesPoint,
} from './server/scales';

// ---- Scale Public Token Actions (service-role) -----------------------------
export {
  getScaleApplicationByToken,
  submitScaleResponsesByToken,
  type GetScaleApplicationByTokenResult,
  type SubmitScaleResponsesByTokenResult,
} from './server/scales-public';

// ---- Scale Application Schemas ----------------------------------------------
export {
  createScaleApplicationSchema,
  submitResponsesSchema,
  submitResponsesByTokenSchema,
  type CreateScaleApplicationInput,
  type SubmitResponsesInput,
  type SubmitResponsesByTokenInput,
} from './lib/scales-schemas';

// ---- Scale Library ----------------------------------------------------------
export {
  scaleByKey,
  AVAILABLE_SCALES,
  SCALE_KEYS,
  type ScaleKey,
  type ScaleDefinition,
  type ScaleQuestion,
  type ScaleOption,
  type ClassificationResult,
} from './lib/scales';

// ---- Attachment Server Actions -----------------------------------------------
export {
  uploadAttachmentImpl,
  listAttachmentsImpl,
  getAttachmentSignedUrlImpl,
  deleteAttachmentImpl,
  type UploadAttachmentResult,
  type ListAttachmentsResult,
  type GetAttachmentSignedUrlResult,
  type DeleteAttachmentResult,
  type AttachmentSummary,
} from './server/attachments';

// ---- Attachment Schemas ------------------------------------------------------
export {
  attachmentCategorySchema,
  uploadAttachmentInputSchema,
  MIME_ALLOWLIST,
  MAX_FILE_SIZE_BYTES,
  type AttachmentCategory,
  type UploadAttachmentInput,
} from './lib/attachment-schemas';

// ---- MIME Validator ----------------------------------------------------------
export { validateMimeType, type MimeValidationResult } from './lib/mime-validator';

// ---- Filename Sanitizer ------------------------------------------------------
export { sanitizeDisplayName, generateStorageFilename } from './lib/filename-sanitizer';

// ---- Scale Public Form (Client Component) -----------------------------------
export { ScalePublicForm } from './components/scale-public-form';

// ---- Scale Tab Components (Client Components) --------------------------------
export { ScalesTab } from './components/scales-tab';
export { ScaleSummaryCard } from './components/scale-summary-card';
export { ScaleHistoryChart } from './components/scale-history-chart';
export { ScaleSelectModal } from './components/scale-select-modal';
export { ScaleApplicationForm } from './components/scale-application-form';

// ---- Scale Severity Tokens ---------------------------------------------------
export {
  classificationToSeverity,
  severityToBadgeVariant,
  severityToDotFill,
} from './lib/scales/severity-tokens';

// ---- Personal Notes Server Actions ------------------------------------------
export {
  getPersonalNotesImpl,
  upsertPersonalNotesImpl,
  setPersonalNotesPasswordImpl,
  removePersonalNotesPasswordImpl,
  type GetPersonalNotesResult,
  type UpsertPersonalNotesResult,
  type SetPersonalNotesPasswordResult,
  type RemovePersonalNotesPasswordResult,
} from './server/personal-notes';

// ---- Personal Notes Schemas -------------------------------------------------
export {
  personalNotesPasswordSchema,
  upsertPersonalNotesInputSchema,
  getPersonalNotesInputSchema,
  type UpsertPersonalNotesInput,
  type GetPersonalNotesInput,
} from './lib/personal-notes-schemas';

// ---- Personal Notes Lockout (pure helpers) -----------------------------------
export {
  assessLockout,
  applyFailedAttempt,
  applySuccessfulVerification,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  type LockoutState,
  type LockoutStatus,
  type FailedAttemptResult,
  type SuccessResult,
} from './lib/personal-notes-lockout';

// ---- Attachment Components (Client Components) ------------------------------
export { AttachmentCard, type AttachmentCardData } from './components/attachment-card';
export { AttachmentUploadSheet } from './components/attachment-upload-sheet';
export { AttachmentsTab } from './components/attachments-tab';
