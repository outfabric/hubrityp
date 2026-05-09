import { z } from 'zod';

/**
 * Zod schema for creating/updating a session location.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Error messages are in pt-BR to match the product surface.
 */

const LOCATION_TYPES = ['in_person', 'online', 'other'] as const;

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const locationInputSchema = z.object({
  name: z
    .string({ message: 'Informe o nome do local.' })
    .trim()
    .min(1, { message: 'O nome do local é obrigatório.' })
    .max(120, { message: 'O nome deve ter no máximo 120 caracteres.' }),

  address: z
    .string()
    .max(500, { message: 'O endereço deve ter no máximo 500 caracteres.' })
    .optional(),

  type: z.enum(LOCATION_TYPES, {
    message: 'Tipo de local inválido. Valores aceitos: in_person, online, other.',
  }),

  color: z
    .string()
    .regex(HEX_COLOR_REGEX, { message: 'Cor inválida. Use o formato hexadecimal (#RRGGBB).' })
    .optional(),

  arrival_instructions: z
    .string()
    .max(2000, { message: 'Instruções de chegada devem ter no máximo 2000 caracteres.' })
    .optional(),

  is_default: z.boolean().optional(),
});

export type LocationInput = z.infer<typeof locationInputSchema>;
