// Public API of the `onboarding` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/onboarding`, never
// from internal paths like `@/modules/onboarding/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. It re-exports pure lib (branded types, Zod schemas, inferred types)
// alongside the server read helpers; a `'use server'` directive here would
// transform every export into an RPC stub and break the schema/type re-exports.

// ---- Branded types + smart constructors --------------------------------------
export { toNpsScore, type NpsScore, type OnboardingStep } from './lib/branded';

// ---- Zod schemas + inferred types --------------------------------------------
export {
  onboardingStepSchema,
  npsAnswerSchema,
  notificationPreferencesSchema,
  type OnboardingStepInput,
  type NpsAnswer,
  type NotificationPreferences,
} from './lib/schemas';

// ---- Checklist item catalog + completion math (pure logic) -------------------
export {
  CHECKLIST_ITEMS,
  isComplete,
  mandatoryCompletePct,
  type ChecklistItem,
  type ChecklistItemKey,
  type ChecklistState,
} from './lib/checklist-items';

// ---- Wizard step model (pure logic) ------------------------------------------
export {
  WIZARD_STEPS,
  nextStep,
  isValidStep,
  resumeStepFromOnboardingStep,
  profileStepSchema,
  locationStepSchema,
  patientsStepSkipSchema,
  type WizardStep,
  type ProfileStepInput,
  type LocationStepInput,
  type PatientsStepSkipInput,
} from './lib/wizard';

// ---- Read helpers (RLS-scoped, single-row reads) -----------------------------
export { getOnboardingChecklist } from './server/read-checklist';
export {
  readOnboardingChecklistSummary,
  type OnboardingChecklistSummary,
} from './server/read-checklist-summary';
export { getNotificationPreferences } from './server/read-preferences';

// ---- Checklist recompute (session-only authz; client userId ignored) ---------
// Re-derives every checklist item from authoritative sources and persists the
// owner's `onboarding_checklist` row. RLS is the backstop.
export {
  recomputeChecklistImpl,
  type RecomputeChecklistResult,
  type RecomputeChecklistOk,
  type RecomputeChecklistUnauthorized,
} from './server/recompute-checklist';

// ---- Step-persistence Server Action implementations --------------------------
// Session-scoped, server-authoritative writes. Authorization is `auth.uid()`
// only; any client-supplied user id is ignored (IDOR-safe). RLS is the backstop.
export {
  saveOnboardingStepImpl,
  type SaveOnboardingStepResult,
} from './server/save-onboarding-step';
export {
  completeOnboardingImpl,
  type CompleteOnboardingResult,
} from './server/complete-onboarding';
export { skipOnboardingImpl, type SkipOnboardingResult } from './server/skip-onboarding';
export { resumeOnboardingStepImpl, type ResumeOnboardingStepResult } from './server/resume-step';
export {
  uploadProfilePhotoImpl,
  type UploadProfilePhotoResult,
} from './server/upload-profile-photo';
export { configureLocationImpl, type ConfigureLocationResult } from './server/configure-location';
export {
  importOnboardingPatientsImpl,
  type ImportOnboardingPatientsResult,
  quickAddOnboardingPatientImpl,
  type QuickAddOnboardingPatientResult,
} from './server/import-onboarding-patients';

// ---- Wizard UI components ----------------------------------------------------
export { WizardProgress, type WizardProgressProps } from './components/wizard-progress';
export {
  StepProfile,
  type StepProfileProps,
  type SaveProfileStepResult,
  type UploadPhotoActionResult,
} from './components/step-profile';
export {
  StepLocation,
  type StepLocationProps,
  type SaveLocationStepResult,
} from './components/step-location';
export {
  StepPatients,
  type StepPatientsProps,
  type OnboardingCsvPatientRow,
  type ImportPatientsStepResult,
  type QuickAddPatientStepResult,
  type SkipPatientsStepResult,
} from './components/step-patients';
export {
  StepDone,
  type StepDoneProps,
  type OnboardingSummary,
  type CompleteOnboardingStepResult,
} from './components/step-done';
export {
  UnfinishedSetupBanner,
  type UnfinishedSetupBannerProps,
} from './components/unfinished-setup-banner';

// ---- Checklist UI components (dashboard first-run + Configurações → Ajuda) ----
export { ChecklistCard, type ChecklistCardProps } from './components/checklist-card';
export {
  ChecklistCelebration,
  type ChecklistCelebrationProps,
} from './components/checklist-celebration';
export { ChecklistSlot, type ChecklistSlotProps } from './components/checklist-slot';
