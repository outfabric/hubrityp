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
// Field schemas
// ---------------------------------------------------------------------------

const earlyReminderHours = z
  .number({ message: 'Informe as horas do lembrete antecipado.' })
  .nullable()
  .refine((val) => val === null || (EARLY_REMINDER_HOURS as readonly number[]).includes(val), {
    message: 'Valor inválido. Escolha 12, 24 ou 48 horas.',
  });

const finalReminderHours = z
  .number({ message: 'Informe as horas do lembrete de confirmação.' })
  .nullable()
  .refine((val) => val === null || (FINAL_REMINDER_HOURS as readonly number[]).includes(val), {
    message: 'Valor inválido. Escolha 0.5, 1 ou 2 horas.',
  });

const videoLinkMinutes = z
  .number({ message: 'Informe os minutos para envio do link de vídeo.' })
  .refine((val) => (VIDEO_LINK_MINUTES as readonly number[]).includes(val), {
    message: 'Valor inválido. Escolha 15, 30 ou 60 minutos.',
  });

const sendDuringNight = z.boolean({ message: 'Informe se deseja enviar durante a noite.' });

/**
 * LGPD consent — the psychologist accepts sending reminders through the
 * platform's shared WhatsApp number and takes responsibility for obtaining the
 * patient's consent. Modelled as `z.literal(true)` so an unchecked box (false)
 * or an absent field never counts as consent.
 */
const consent = z.literal(true, {
  message: 'Você precisa aceitar o termo de consentimento para ativar os lembretes no WhatsApp.',
});

const baseShape = {
  early_reminder_hours: earlyReminderHours,
  final_reminder_hours: finalReminderHours,
  video_link_minutes: videoLinkMinutes,
  send_during_night: sendDuringNight,
} as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Base reminder-settings schema. `consent` is optional here because it is only
 * required on the very first save (before a WhatsApp account exists). This is
 * the schema used by the form resolver and by saves where the account is
 * already provisioned. A `consent: false` value is still rejected.
 */
export const reminderSettingsSchema = z.object({
  ...baseShape,
  consent: consent.optional(),
});

/**
 * Consent-required variant — enforced by `saveReminderSettingsImpl` on the
 * first save, when the psychologist has no WhatsApp account yet and the save
 * will provision one. Rejects a missing or `false` consent.
 */
export const reminderSettingsWithConsentSchema = z.object({
  ...baseShape,
  consent,
});

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>;
