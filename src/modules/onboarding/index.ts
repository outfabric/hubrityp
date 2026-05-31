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
export { getNotificationPreferences } from './server/read-preferences';

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

// ---- Wizard UI components ----------------------------------------------------
export { WizardProgress, type WizardProgressProps } from './components/wizard-progress';
export {
  StepProfile,
  type StepProfileProps,
  type SaveProfileStepResult,
  type UploadPhotoActionResult,
} from './components/step-profile';
