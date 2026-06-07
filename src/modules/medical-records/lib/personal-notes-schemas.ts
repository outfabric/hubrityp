import { z } from 'zod';

// ---------------------------------------------------------------------------
// Personal notes password schema
// ---------------------------------------------------------------------------

/**
 * Minimum 6 characters for the personal-notes privacy password.
 *
 * This is a UX-level convenience gate (not cryptographic security) — the
 * data is not encrypted at rest. See design.md Decision #1.
 */
export const personalNotesPasswordSchema = z
  .string()
  .min(6, { message: 'A senha deve ter no mínimo 6 caracteres.' });

// ---------------------------------------------------------------------------
// Upsert personal notes input
// ---------------------------------------------------------------------------

/**
 * Input for creating or updating personal notes content.
 *
 * `patientId` is validated here but MUST be cross-checked against session
 * ownership server-side (never trusted from client alone).
 */
export const upsertPersonalNotesInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  content: z.string(),
});

export type UpsertPersonalNotesInput = z.infer<typeof upsertPersonalNotesInputSchema>;

// ---------------------------------------------------------------------------
// Get personal notes input
// ---------------------------------------------------------------------------

/**
 * Input for retrieving personal notes (optionally with password unlock).
 */
export const getPersonalNotesInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  password: z.string().optional(),
});

export type GetPersonalNotesInput = z.infer<typeof getPersonalNotesInputSchema>;
