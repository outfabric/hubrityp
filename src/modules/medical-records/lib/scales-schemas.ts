import { z } from 'zod';

import { SCALE_KEYS } from './scales';

/**
 * Zod schemas for the scale-application domain.
 *
 * Used at Server Action / Route Handler boundaries to validate input
 * before any business logic runs.
 */

// ---------------------------------------------------------------------------
// Create scale application
// ---------------------------------------------------------------------------

export const createScaleApplicationSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  scaleKey: z.enum(SCALE_KEYS, { message: 'Escala invalida.' }),
  mode: z.enum(['in-session', 'remote'], { message: 'Modo deve ser "in-session" ou "remote".' }),
  expiresInHours: z.number().int().positive().max(720).optional(),
});

export type CreateScaleApplicationInput = z.infer<typeof createScaleApplicationSchema>;

// ---------------------------------------------------------------------------
// Submit responses (authenticated psychologist, by applicationId)
// ---------------------------------------------------------------------------

export const submitResponsesSchema = z.object({
  applicationId: z.string().uuid({ message: 'applicationId deve ser um UUID valido.' }),
  responses: z.record(z.string(), z.number().int().nonnegative()),
});

export type SubmitResponsesInput = z.infer<typeof submitResponsesSchema>;

// ---------------------------------------------------------------------------
// Submit responses by token (public patient link, no auth)
// ---------------------------------------------------------------------------

export const submitResponsesByTokenSchema = z.object({
  token: z.string().length(64, { message: 'Token deve ter exatamente 64 caracteres.' }),
  responses: z.record(z.string(), z.number().int().nonnegative()),
});

export type SubmitResponsesByTokenInput = z.infer<typeof submitResponsesByTokenSchema>;
