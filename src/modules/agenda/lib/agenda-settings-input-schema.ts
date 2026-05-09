import { z } from 'zod';

/**
 * Zod schema for agenda settings (psychologist-level preferences).
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Error messages are in pt-BR to match the product surface.
 */

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const businessHourEntrySchema = z
  .object({
    day: z
      .number({ message: 'Dia da semana é obrigatório.' })
      .int({ message: 'Dia da semana deve ser inteiro.' })
      .min(0, { message: 'Dia da semana deve ser entre 0 (domingo) e 6 (sábado).' })
      .max(6, { message: 'Dia da semana deve ser entre 0 (domingo) e 6 (sábado).' }),
    start: z
      .string({ message: 'Horário de início é obrigatório.' })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
        message: 'Horário de início inválido. Use o formato HH:MM.',
      }),
    end: z
      .string({ message: 'Horário de término é obrigatório.' })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
        message: 'Horário de término inválido. Use o formato HH:MM.',
      }),
  })
  .refine((entry) => entry.end > entry.start, {
    message: 'O horário de término deve ser posterior ao horário de início.',
    path: ['end'],
  });

export const agendaSettingsInputSchema = z.object({
  default_duration_minutes: z
    .number({ message: 'Informe a duração padrão da sessão.' })
    .int({ message: 'A duração deve ser um número inteiro.' })
    .min(15, { message: 'A duração mínima é de 15 minutos.' })
    .max(240, { message: 'A duração máxima é de 240 minutos.' }),

  interval_minutes: z
    .number({ message: 'Informe o intervalo entre sessões.' })
    .int({ message: 'O intervalo deve ser um número inteiro.' })
    .min(0, { message: 'O intervalo não pode ser negativo.' })
    .max(60, { message: 'O intervalo máximo é de 60 minutos.' }),

  business_hours: z.array(businessHourEntrySchema, {
    message: 'Horários de atendimento devem ser uma lista.',
  }),

  cancellation_policy: z
    .string()
    .max(2000, { message: 'A política de cancelamento deve ter no máximo 2000 caracteres.' })
    .optional(),

  default_color: z
    .string()
    .regex(HEX_COLOR_REGEX, {
      message: 'Cor padrão inválida. Use o formato hexadecimal (#RRGGBB).',
    })
    .optional(),
});

export type AgendaSettingsInput = z.infer<typeof agendaSettingsInputSchema>;
