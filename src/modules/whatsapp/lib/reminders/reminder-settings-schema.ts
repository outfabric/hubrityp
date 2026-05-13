/**
 * Reminder settings schema — Zod validation for psychologist reminder preferences.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Validates timing windows for early reminders, final reminders,
 * video-link delivery, and night-send preferences.
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Allowed values
// ---------------------------------------------------------------------------

/** Hours before session for the early ("antecipado") reminder. */
const EARLY_REMINDER_HOURS = [12, 24, 48] as const;

/** Hours before session for the final ("de confirmacao") reminder. */
const FINAL_REMINDER_HOURS = [0.5, 1, 2] as const;

/** Minutes before session to send the video link. */
const VIDEO_LINK_MINUTES = [15, 30, 60] as const;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const reminderSettingsSchema = z.object({
  early_reminder_hours: z
    .number({ message: 'Informe as horas do lembrete antecipado.' })
    .nullable()
    .refine(
      (val) => val === null || (EARLY_REMINDER_HOURS as readonly number[]).includes(val),
      { message: 'Valor inválido. Escolha 12, 24 ou 48 horas.' },
    ),

  final_reminder_hours: z
    .number({ message: 'Informe as horas do lembrete de confirmação.' })
    .nullable()
    .refine(
      (val) => val === null || (FINAL_REMINDER_HOURS as readonly number[]).includes(val),
      { message: 'Valor inválido. Escolha 0.5, 1 ou 2 horas.' },
    ),

  video_link_minutes: z
    .number({ message: 'Informe os minutos para envio do link de vídeo.' })
    .refine((val) => (VIDEO_LINK_MINUTES as readonly number[]).includes(val), {
      message: 'Valor inválido. Escolha 15, 30 ou 60 minutos.',
    }),

  send_during_night: z.boolean({ message: 'Informe se deseja enviar durante a noite.' }),
});

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>;
