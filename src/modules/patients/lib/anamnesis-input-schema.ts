import { z } from 'zod';

// ---------------------------------------------------------------------------
// Custom section schema (free-form JSONB entries)
// ---------------------------------------------------------------------------

export const customSectionSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(50_000),
});

// ---------------------------------------------------------------------------
// Upsert anamnesis input schema
// ---------------------------------------------------------------------------

/**
 * Validates the payload for upsert-anamnesis. All clinical sections are
 * optional — the psychologist fills them progressively, and auto-save sends
 * whatever is currently in the form.
 *
 * `patientId` is required to identify which patient the anamnesis belongs to.
 */
export const upsertAnamnesisSchema = z.object({
  patientId: z.string().uuid(),
  chiefComplaint: z.string().max(50_000).nullish(),
  historyPresentIllness: z.string().max(50_000).nullish(),
  familyHistory: z.string().max(50_000).nullish(),
  educationalProfessional: z.string().max(50_000).nullish(),
  physicalHealth: z.string().max(50_000).nullish(),
  priorTherapy: z.string().max(50_000).nullish(),
  initialHypothesis: z.string().max(50_000).nullish(),
  treatmentPlan: z.string().max(50_000).nullish(),
  customSections: z.array(customSectionSchema).nullish(),
});

export type UpsertAnamnesisInput = z.infer<typeof upsertAnamnesisSchema>;
