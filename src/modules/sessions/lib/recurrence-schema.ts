/**
 * Zod schemas for recurrence-related input validation.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Three schemas:
 *   1. `recurrenceFormSchema` — defines a recurrence rule
 *   2. `coupleSessionSchema` — validates `patient_ids` for couple sessions
 *   3. `lateRecordSchema` — validates retroactive session records
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared regex
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// 1. Recurrence Form Schema
// ---------------------------------------------------------------------------

export const recurrenceFormSchema = z
  .object({
    frequency: z.enum(['weekly', 'biweekly', 'monthly', 'custom'], {
      message: 'Selecione a frequência da recorrência.',
    }),

    daysOfWeek: z
      .array(
        z
          .number()
          .int({ message: 'Dia da semana deve ser um número inteiro.' })
          .min(0, { message: 'Dia da semana deve ser entre 0 (domingo) e 6 (sábado).' })
          .max(6, { message: 'Dia da semana deve ser entre 0 (domingo) e 6 (sábado).' }),
      )
      .optional(),

    startDate: z
      .string({ message: 'Informe a data de início.' })
      .datetime({ message: 'Data de início inválida. Use o formato ISO 8601.' }),

    endDate: z
      .string()
      .datetime({ message: 'Data de término inválida. Use o formato ISO 8601.' })
      .optional(),

    occurrenceCount: z
      .number()
      .int({ message: 'O número de sessões deve ser um inteiro.' })
      .min(2, { message: 'O número mínimo de sessões é 2.' })
      .max(104, { message: 'O número máximo de sessões é 104.' })
      .optional(),

    isIndefinite: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    // At least one end condition must be specified.
    if (!data.endDate && data.occurrenceCount == null && !data.isIndefinite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Informe uma condição de término: data final, número de sessões, ou marque como indefinido.',
        path: ['endDate'],
      });
    }

    // daysOfWeek is required for weekly and custom frequencies.
    if (
      (data.frequency === 'weekly' || data.frequency === 'custom') &&
      (!data.daysOfWeek || data.daysOfWeek.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selecione ao menos um dia da semana para a frequência semanal ou personalizada.',
        path: ['daysOfWeek'],
      });
    }
  });

export type RecurrenceFormInput = z.infer<typeof recurrenceFormSchema>;

// ---------------------------------------------------------------------------
// 2. Couple Session Schema
// ---------------------------------------------------------------------------

export const coupleSessionSchema = z
  .object({
    patient_ids: z
      .array(z.string().regex(UUID_REGEX, { message: 'ID de paciente inválido.' }))
      .min(2, { message: 'Um atendimento de casal exige 2 pacientes.' })
      .max(2, { message: 'Um atendimento de casal aceita no máximo 2 pacientes.' }),
  })
  .superRefine((data, ctx) => {
    // All patient_ids must be distinct.
    const unique = new Set(data.patient_ids);
    if (unique.size !== data.patient_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selecione pacientes diferentes.',
        path: ['patient_ids'],
      });
    }
  });

export type CoupleSessionInput = z.infer<typeof coupleSessionSchema>;

// ---------------------------------------------------------------------------
// 3. Late Record Schema
// ---------------------------------------------------------------------------

export const lateRecordSchema = z
  .object({
    is_late_record: z.boolean(),

    date: z
      .string({ message: 'Informe a data da sessão.' })
      .datetime({ message: 'Data inválida. Use o formato ISO 8601.' }),
  })
  .superRefine((data, ctx) => {
    // When flagged as late record, the date must be in the past.
    if (data.is_late_record) {
      const sessionDate = new Date(data.date);
      if (sessionDate >= new Date()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Lançamentos retroativos devem ter uma data no passado.',
          path: ['date'],
        });
      }
    }
  });

export type LateRecordInput = z.infer<typeof lateRecordSchema>;
