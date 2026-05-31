/**
 * Pure step model for the onboarding wizard.
 *
 * This file is the single source of truth for the wizard's step ordering, the
 * per-step input schemas, and the rule that maps a persisted
 * `profiles.onboarding_step` value to the segment the user should resume at.
 *
 * Pure logic only — no Node-only, DB, or `'use server'` imports. Consumers
 * (the wizard route, layout, and Server Actions) import these helpers through
 * the module barrel `@/modules/onboarding`.
 *
 * SECURITY NOTE: resume logic derives exclusively from the owner's persisted
 * `onboarding_step` (read server-side), never from client state. {@link isValidStep}
 * is the allowlist that lets the `[step]` route 404 on any segment that is not a
 * real wizard step — `welcome`, `done`, and anything else (e.g. `billing`) are
 * NOT navigable wizard steps and must be rejected.
 */

import { z } from 'zod';

import { locationInputSchema } from '@/modules/agenda';

import type { OnboardingStep } from './branded';

/**
 * The ordered, navigable steps of the onboarding wizard.
 *
 * These are the exactly four MVP steps the user walks through, in order. Note
 * this is a strict subset of {@link OnboardingStep}: the persisted column also
 * carries `welcome` (pre-wizard) and `done` (terminal), neither of which is a
 * navigable `[step]` segment.
 */
export const WIZARD_STEPS = ['profile', 'location', 'patients', 'done'] as const;

/**
 * A single navigable wizard step segment (the URL `[step]` param).
 */
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * Returns the step that follows `step` in the wizard order, or `null` when
 * `step` is the terminal step (`done`).
 */
export function nextStep(step: WizardStep): WizardStep | null {
  const index = WIZARD_STEPS.indexOf(step);
  const next = WIZARD_STEPS[index + 1];
  return next ?? null;
}

/**
 * Type guard: is `segment` a valid, navigable wizard step?
 *
 * Used by the `[step]` route to 404 on anything that is not one of
 * {@link WIZARD_STEPS}. Rejects `welcome`, `billing`, and every other
 * non-wizard value. Accepts an `unknown`/`string` so callers can pass the raw
 * route param without a prior cast.
 */
export function isValidStep(segment: string): segment is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(segment);
}

/**
 * Maps a persisted `profiles.onboarding_step` value to the wizard segment the
 * user should resume at.
 *
 * The persisted column ({@link OnboardingStep}) is the authoritative state:
 * - `welcome` → the user has not started a wizard step yet; resume at the first
 *   step (`profile`).
 * - `profile` / `location` / `patients` / `done` → resume at the same segment.
 *
 * The derivation is total over the {@link OnboardingStep} union, so an
 * exhaustive `switch` would be valid; the lookup table keeps it declarative and
 * makes the `welcome → profile` redirect explicit.
 */
export function resumeStepFromOnboardingStep(step: OnboardingStep): WizardStep {
  return ONBOARDING_STEP_TO_WIZARD_STEP[step];
}

const ONBOARDING_STEP_TO_WIZARD_STEP: Record<OnboardingStep, WizardStep> = {
  welcome: 'profile',
  profile: 'profile',
  location: 'location',
  patients: 'patients',
  done: 'done',
};

// ---- Per-step input schemas --------------------------------------------------

/**
 * Input schema for the `profile` step ("Sobre você").
 *
 * Captures the minimal profile details the wizard collects up front. CRP and
 * identity fields are owned by registration and are NOT re-collected here;
 * this step gathers display/contact details. Error messages are in pt-BR to
 * match the product surface.
 */
export const profileStepSchema = z.object({
  displayName: z
    .string({ message: 'Informe como você quer ser chamado.' })
    .trim()
    .min(1, { message: 'O nome de exibição é obrigatório.' })
    .max(120, { message: 'O nome deve ter no máximo 120 caracteres.' }),

  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s()-]{8,20}$/, {
      message: 'Telefone inválido.',
    })
    .optional(),

  bio: z
    .string()
    .trim()
    .max(2000, { message: 'A bio deve ter no máximo 2000 caracteres.' })
    .optional(),
});

/**
 * Input schema for the `location` step ("Local e agenda").
 *
 * Re-uses the agenda module's {@link locationInputSchema} so the wizard and the
 * agenda settings screen validate locations identically — a single source of
 * truth for the location shape.
 */
export const locationStepSchema = locationInputSchema;

/**
 * Input schema for skipping the `patients` step ("Importe pacientes").
 *
 * Importing patients is optional in the MVP wizard; the user may skip it. This
 * schema validates the explicit skip action so the Server Action can advance
 * the step without ingesting any patient data.
 */
export const patientsStepSkipSchema = z.object({
  skip: z.literal(true),
});

export type ProfileStepInput = z.infer<typeof profileStepSchema>;
export type LocationStepInput = z.infer<typeof locationStepSchema>;
export type PatientsStepSkipInput = z.infer<typeof patientsStepSkipSchema>;
