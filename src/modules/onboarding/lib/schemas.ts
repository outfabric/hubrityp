/**
 * Zod schemas for onboarding inputs.
 *
 * These schemas are the single source of truth for onboarding-related shapes:
 * runtime validation at the boundary plus the inferred TypeScript types consumed
 * by the rest of the module. Pure logic — no Node-only or DB imports.
 */

import { z } from 'zod';

import type { OnboardingStep } from './branded';

/**
 * Validates an onboarding wizard step.
 *
 * Kept in sync with the {@link OnboardingStep} union; the `satisfies` clause makes
 * the compiler flag any drift between the enum values and the type.
 */
export const onboardingStepSchema = z.enum([
  'welcome',
  'profile',
  'location',
  'patients',
  'done',
] satisfies readonly OnboardingStep[]);

/**
 * Validates an NPS answer submitted by a psychologist.
 *
 * `score` is an integer 0–10; `feedback` is optional free text capped at 2000
 * characters to bound storage and avoid abuse.
 */
export const npsAnswerSchema = z.object({
  score: z.number().int().min(0).max(10),
  feedback: z.string().max(2000).optional(),
});

/**
 * Validates a psychologist's notification preferences.
 */
export const notificationPreferencesSchema = z.object({
  emailDaily: z.boolean(),
  emailWeekly: z.boolean(),
  emailCritical: z.boolean(),
  inAppSound: z.boolean(),
});

export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;
export type NpsAnswer = z.infer<typeof npsAnswerSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
