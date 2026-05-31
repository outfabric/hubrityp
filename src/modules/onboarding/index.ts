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

// ---- Read helpers (RLS-scoped, single-row reads) -----------------------------
export { getOnboardingChecklist } from './server/read-checklist';
export { getNotificationPreferences } from './server/read-preferences';
