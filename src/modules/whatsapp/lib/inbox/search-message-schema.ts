/**
 * Search-message input schema — Zod validation for the inbox message
 * search endpoint.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Validates search query, optional patient filter, optional date range
 * (with refinement ensuring `to >= from`), and pagination parameters
 * with sensible defaults.
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const searchMessageSchema = z
  .object({
    query: z
      .string({ message: 'A busca é obrigatória.' })
      .min(1, { message: 'A busca não pode estar vazia.' })
      .max(200, { message: 'A busca deve ter no máximo 200 caracteres.' }),

    patientId: z.string().uuid({ message: 'ID do paciente inválido.' }).optional(),

    dateRange: z
      .object({
        from: z.string().date('Data inicial inválida (esperado formato ISO yyyy-MM-dd).'),
        to: z.string().date('Data final inválida (esperado formato ISO yyyy-MM-dd).'),
      })
      .optional(),

    page: z
      .number({ message: 'Página deve ser um número.' })
      .int({ message: 'Página deve ser um número inteiro.' })
      .min(1, { message: 'Página mínima é 1.' })
      .default(1),

    pageSize: z
      .number({ message: 'Tamanho da página deve ser um número.' })
      .int({ message: 'Tamanho da página deve ser um número inteiro.' })
      .min(10, { message: 'Tamanho mínimo da página é 10.' })
      .max(100, { message: 'Tamanho máximo da página é 100.' })
      .default(20),
  })
  .refine(
    (data) => {
      if (!data.dateRange) return true;
      return data.dateRange.to >= data.dateRange.from;
    },
    {
      message: 'A data final deve ser igual ou posterior à data inicial.',
      path: ['dateRange', 'to'],
    },
  );

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type SearchMessageInput = z.infer<typeof searchMessageSchema>;
