import { z } from 'zod';

/**
 * Zod schemas for treatment plan domain (plano terapeutico).
 *
 * Field names use camelCase matching the Drizzle column mappings and
 * the Server Action / component interface contract.
 */

// ---------------------------------------------------------------------------
// Nested JSONB schemas
// ---------------------------------------------------------------------------

/**
 * A therapeutic goal within the plan.
 * targetDate is nullable (goal may not have a deadline).
 */
export const goalSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1, 'Descricao obrigatoria'),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
    .nullable(),
  order: z.number().int().nonnegative(),
});

/**
 * A treatment phase within the plan.
 */
export const phaseSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Titulo obrigatorio'),
  description: z.string(),
  order: z.number().int().nonnegative(),
  completed: z.boolean(),
});

// ---------------------------------------------------------------------------
// Input schemas (Server Action boundaries)
// ---------------------------------------------------------------------------

/**
 * Input for creating or updating a treatment plan (upsert).
 */
export const upsertTreatmentPlanInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  goals: z.array(goalSchema),
  phases: z.array(phaseSchema),
  resources: z.string().nullable(),
  successCriteria: z.string().nullable(),
});

/**
 * Input for fetching a treatment plan by patient.
 */
export const getTreatmentPlanInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
});

/**
 * Input for listing treatment plan versions.
 */
export const listTreatmentPlanVersionsInputSchema = z.object({
  planId: z.string().uuid({ message: 'planId deve ser um UUID valido.' }),
});

// ---------------------------------------------------------------------------
// Version content schema (JSONB snapshot stored in plan_versions)
// ---------------------------------------------------------------------------

/**
 * The shape of the JSONB `content` column in `treatment_plan_versions`.
 */
export const versionContentSchema = z.object({
  goals: z.array(goalSchema),
  phases: z.array(phaseSchema),
  resources: z.string().nullable(),
  successCriteria: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Goal = z.infer<typeof goalSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type TreatmentPlanInput = z.infer<typeof upsertTreatmentPlanInputSchema>;
export type VersionContent = z.infer<typeof versionContentSchema>;
