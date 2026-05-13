/**
 * Template input schema — Zod validation for template editing.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Validates that the template body only references variables from the
 * fixed dictionary (PRD RF-04.08). Error messages are in pt-BR.
 */

import { z } from 'zod';

import { templateKeySchema } from './template-key-schema';
import { VALID_VARIABLE_KEYS } from './template-variables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all `{variable}` occurrences from a template body. */
function extractVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const templateInputSchema = z
  .object({
    body: z
      .string({ message: 'O corpo do template é obrigatório.' })
      .min(10, { message: 'O corpo do template deve ter pelo menos 10 caracteres.' })
      .max(1024, { message: 'O corpo do template deve ter no máximo 1024 caracteres.' }),

    template_key: templateKeySchema,
  })
  .superRefine((data, ctx) => {
    const variables = extractVariables(data.body);

    for (const variable of variables) {
      if (!VALID_VARIABLE_KEYS.has(variable)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variável {${variable}} não reconhecida.`,
          path: ['body'],
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type TemplateInput = z.infer<typeof templateInputSchema>;
