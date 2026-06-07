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
  description: z.string().min(1, 'Descrição obrigatória').max(5_000),
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
  title: z.string().min(1, 'Título obrigatório').max(500),
  description: z.string().max(5_000),
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
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  goals: z.array(goalSchema).max(100),
  phases: z.array(phaseSchema).max(100),
  resources: z.string().max(50_000).nullable(),
  successCriteria: z.string().max(50_000).nullable(),
});

/**
 * Input for fetching a treatment plan by patient.
 */
export const getTreatmentPlanInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
});

/**
 * Input for listing treatment plan versions.
 */
export const listTreatmentPlanVersionsInputSchema = z.object({
  planId: z.string().uuid({ message: 'planId deve ser um UUID válido.' }),
});

// ---------------------------------------------------------------------------
// Version content schema (JSONB snapshot stored in plan_versions)
// ---------------------------------------------------------------------------

/**
 * The shape of the JSONB `content` column in `treatment_plan_versions`.
 */
export const versionContentSchema = z.object({
  goals: z.array(goalSchema).max(100),
  phases: z.array(phaseSchema).max(100),
  resources: z.string().max(50_000).nullable(),
  successCriteria: z.string().max(50_000).nullable(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Goal = z.infer<typeof goalSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type TreatmentPlanInput = z.infer<typeof upsertTreatmentPlanInputSchema>;
export type VersionContent = z.infer<typeof versionContentSchema>;
