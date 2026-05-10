/**
 * Cancellation input schema — Zod validation for the cancel session action.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const cancelSessionInputSchema = z.object({
  sessionId: z.string().uuid({ message: 'ID da sessão inválido.' }),

  reason: z.enum(['patient_cancelled', 'therapist_cancelled', 'unforeseen', 'other'], {
    message: 'Motivo de cancelamento inválido.',
  }),

  cancelledBy: z.enum(['patient', 'therapist'], {
    message: 'Valor inválido para quem cancelou.',
  }),

  chargeCancellation: z.boolean({ message: 'Informe se a sessão deve ser cobrada.' }),

  isReschedule: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type CancelSessionInput = z.infer<typeof cancelSessionInputSchema>;
