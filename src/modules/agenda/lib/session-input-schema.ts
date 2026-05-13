import { z } from 'zod';

/**
 * Zod schema for creating/updating a session (sessao).
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Conditional requirements:
 *   - is_blocking = true  -> blocking_title is required, patient_id is not
 *   - is_blocking = false -> patient_id is required, blocking_title is not
 *
 * Error messages are in pt-BR to match the product surface.
 */

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseSessionSchema = z.object({
  patient_id: z.string().regex(UUID_REGEX, { message: 'ID do paciente inválido.' }).optional(),

  is_blocking: z.boolean().optional().default(false),

  blocking_title: z
    .string()
    .max(120, { message: 'O título do bloqueio deve ter no máximo 120 caracteres.' })
    .optional(),

  start_at: z
    .string({ message: 'Informe a data e hora de início.' })
    .datetime({ message: 'Data/hora de início inválida. Use o formato ISO 8601.' }),

  duration_minutes: z
    .number({ message: 'Informe a duração da sessão.' })
    .int({ message: 'A duração deve ser um número inteiro.' })
    .min(15, { message: 'A duração mínima é de 15 minutos.' })
    .max(480, { message: 'A duração máxima é de 480 minutos.' }),

  location_id: z.string().regex(UUID_REGEX, { message: 'ID do local inválido.' }).optional(),

  modality: z
    .enum(['in_person', 'online'], {
      message: 'Modalidade inválida. Valores aceitos: in_person, online.',
    })
    .optional(),

  amount: z.preprocess(
    (v) => (v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    z
      .string()
      .refine(
        (v) => {
          const num = Number(v);
          return !Number.isNaN(num) && num > 0;
        },
        { message: 'O valor deve ser um número positivo.' },
      )
      .optional(),
  ),

  notes: z
    .string()
    .max(2000, { message: 'As observações devem ter no máximo 2000 caracteres.' })
    .optional(),

  color: z
    .string()
    .regex(HEX_COLOR_REGEX, { message: 'Cor inválida. Use o formato hexadecimal (#RRGGBB).' })
    .optional(),

  reminders_disabled: z.boolean().optional().default(false),

  force_conflict: z.boolean().optional(),
});

export const sessionInputSchema = baseSessionSchema.superRefine((data, ctx) => {
  if (data.is_blocking) {
    // Blocking slots require a title
    if (!data.blocking_title || data.blocking_title.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O título do bloqueio é obrigatório.',
        path: ['blocking_title'],
      });
    }
  } else {
    // Regular sessions require a patient
    if (!data.patient_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O paciente é obrigatório para sessões regulares.',
        path: ['patient_id'],
      });
    }
  }
});

export type SessionInput = z.infer<typeof sessionInputSchema>;
