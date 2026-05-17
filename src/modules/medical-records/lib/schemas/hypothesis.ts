import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

const HYPOTHESIS_STATUSES = ['investigating', 'confirmed', 'discarded'] as const;

export const hypothesisStatusSchema = z.enum(HYPOTHESIS_STATUSES, {
  message: 'Status deve ser investigating, confirmed ou discarded.',
});

export type HypothesisStatus = z.infer<typeof hypothesisStatusSchema>;

// ---------------------------------------------------------------------------
// Create hypothesis input
// ---------------------------------------------------------------------------

/**
 * Input for creating a new diagnostic hypothesis.
 *
 * Refinement: at least one of `description` or `cid10Code` must be provided.
 * This mirrors the DB CHECK constraint `chk_hypothesis_has_descriptor`.
 */
export const createHypothesisSchema = z
  .object({
    patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
    description: z.string().min(1).optional(),
    cid10Code: z.string().min(1).max(10).optional(),
    cid10Description: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => Boolean(data.description) || Boolean(data.cid10Code), {
    message: 'Pelo menos description ou cid10Code deve ser informado.',
    path: ['description'],
  });

export type CreateHypothesisInput = z.infer<typeof createHypothesisSchema>;

// ---------------------------------------------------------------------------
// Update hypothesis input
// ---------------------------------------------------------------------------

/**
 * Input for updating an existing diagnostic hypothesis.
 *
 * The "at least one of description/cid10Code" refinement applies when the
 * caller explicitly sets both to undefined/null/empty — i.e., attempts to
 * clear both descriptors. If neither field is present in the payload (the
 * caller is not touching those fields), the refinement passes because
 * `undefined` means "no change" and the existing DB values are preserved.
 *
 * Per spec scenario "Update rejects clearing both description and CID-10":
 * sending `{ description: '', cid10Code: '' }` or `{ description: null,
 * cid10Code: null }` is rejected.
 */
export const updateHypothesisSchema = z
  .object({
    hypothesisId: z.string().uuid({ message: 'hypothesisId deve ser um UUID valido.' }),
    description: z.string().optional(),
    cid10Code: z.string().max(10).optional(),
    cid10Description: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      const descriptionProvided = 'description' in data && data.description !== undefined;
      const cid10CodeProvided = 'cid10Code' in data && data.cid10Code !== undefined;

      // If neither field is being touched, pass — existing DB values remain.
      if (!descriptionProvided && !cid10CodeProvided) {
        return true;
      }

      // If at least one field is being set to a non-empty value, pass.
      const descriptionHasValue = descriptionProvided && data.description!.length > 0;
      const cid10CodeHasValue = cid10CodeProvided && data.cid10Code!.length > 0;

      return descriptionHasValue || cid10CodeHasValue;
    },
    {
      message: 'Pelo menos description ou cid10Code deve ser informado.',
      path: ['description'],
    },
  );

export type UpdateHypothesisInput = z.infer<typeof updateHypothesisSchema>;

// ---------------------------------------------------------------------------
// Update hypothesis status input
// ---------------------------------------------------------------------------

/**
 * Input for transitioning a hypothesis status.
 * All transitions are allowed (investigating <-> confirmed <-> discarded).
 */
export const updateHypothesisStatusSchema = z.object({
  hypothesisId: z.string().uuid({ message: 'hypothesisId deve ser um UUID valido.' }),
  status: hypothesisStatusSchema,
  notes: z.string().optional(),
});

export type UpdateHypothesisStatusInput = z.infer<typeof updateHypothesisStatusSchema>;
