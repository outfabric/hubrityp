/**
 * Free-text reply input schema — Zod validation for outbound WhatsApp
 * free-text replies.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Includes a refinement that calls `checkClinicalContent` to prevent
 * psychologists from accidentally sending clinical content through an
 * unencrypted messaging channel.
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

import { checkClinicalContent } from './clinical-content-blocker';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const freeTextReplySchema = z.object({
  body: z
    .string({ message: 'A mensagem é obrigatória.' })
    .min(1, { message: 'A mensagem não pode estar vazia.' })
    .max(4096, { message: 'A mensagem deve ter no máximo 4096 caracteres.' })
    .superRefine((text, ctx) => {
      const result = checkClinicalContent(text);
      if (!result.allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            result.reason ?? 'Conteúdo clínico detectado. Não envie dados clínicos por WhatsApp.',
        });
      }
    }),
});

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type FreeTextReplyInput = z.infer<typeof freeTextReplySchema>;
