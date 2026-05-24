/**
 * Inngest event payload schemas for session lifecycle events.
 *
 * Each schema is the single source of truth for the shape of the
 * corresponding Inngest event payload. Server Actions validate outbound
 * payloads before sending, and Inngest functions validate inbound
 * payloads on receipt.
 *
 * All schemas use Zod; TypeScript types are derived via `z.infer`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const uuidField = z.string().uuid();
const dateField = z.coerce.date();

// ---------------------------------------------------------------------------
// Event schemas (per design.md Decision #5)
// ---------------------------------------------------------------------------

/** `agenda/session.created` — a new session is created. */
export const sessionCreatedEventSchema = z.object({
  sessionId: uuidField,
  userId: uuidField,
  patientId: uuidField.nullable(),
  modality: z.string().nullable(),
  status: z.string(),
  startAt: dateField,
  endAt: dateField,
});
export type SessionCreatedEvent = z.infer<typeof sessionCreatedEventSchema>;

/** `agenda/session.updated` — an existing session is updated. */
export const sessionUpdatedEventSchema = z.object({
  sessionId: uuidField,
  userId: uuidField,
  patientId: uuidField.nullable(),
  modality: z.string().nullable(),
  status: z.string(),
  startAt: dateField,
  endAt: dateField,
  /** Previous modality before the update — used to detect online->in_person transitions. */
  previousModality: z.string().nullable().optional(),
});
export type SessionUpdatedEvent = z.infer<typeof sessionUpdatedEventSchema>;

/** `agenda/session.confirmed` — patient or therapist confirms attendance. */
export const sessionConfirmedEventSchema = z.object({
  sessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  confirmedAt: dateField,
  confirmedBy: z.enum(['patient', 'therapist']),
});
export type SessionConfirmedEvent = z.infer<typeof sessionConfirmedEventSchema>;

/** `agenda/session.cancelled` — session is cancelled by either party. */
export const sessionCancelledEventSchema = z.object({
  sessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  cancelledAt: dateField,
  cancelledBy: z.enum(['patient', 'therapist']),
  reason: z.string(),
  notice: z.enum(['24h+', 'less_24h', 'less_1h', 'on_time']),
  chargeApplied: z.boolean(),
});
export type SessionCancelledEvent = z.infer<typeof sessionCancelledEventSchema>;

/** `agenda/session.done` — psychologist marks the session as completed. */
export const sessionDoneEventSchema = z.object({
  sessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  doneAt: dateField,
});
export type SessionDoneEvent = z.infer<typeof sessionDoneEventSchema>;

/** `agenda/session.no_show` — psychologist marks the patient as absent. */
export const sessionNoShowEventSchema = z.object({
  sessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  noShowAt: dateField,
});
export type SessionNoShowEvent = z.infer<typeof sessionNoShowEventSchema>;

/** `agenda/session.rescheduled` — session is moved to a new time slot. */
export const sessionRescheduledEventSchema = z.object({
  oldSessionId: uuidField,
  newSessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  rescheduledAt: dateField,
});
export type SessionRescheduledEvent = z.infer<typeof sessionRescheduledEventSchema>;

/** `agenda/session.missing_note_reminder` — reminder that a completed session lacks notes. */
export const sessionMissingNoteReminderEventSchema = z.object({
  sessionId: uuidField,
  patientId: uuidField,
  userId: uuidField,
  doneAt: dateField,
  daysSinceDone: z.number().int().nonnegative(),
});
export type SessionMissingNoteReminderEvent = z.infer<typeof sessionMissingNoteReminderEventSchema>;
