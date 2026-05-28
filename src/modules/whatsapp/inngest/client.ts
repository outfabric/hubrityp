/**
 * Inngest client and typed event definitions for the WhatsApp module.
 *
 * Defines the shared Inngest client and event data interfaces for the
 * reminder pipeline, webhook processing, and patient interactions.
 *
 * All WhatsApp-related Inngest functions import from this file to get
 * the shared client and typed event data interfaces.
 */

import { encryptionMiddleware } from '@inngest/middleware-encryption';
import { Inngest } from 'inngest';

import { serverEnv } from '@/shared/env';

// ---------------------------------------------------------------------------
// Event data types
// ---------------------------------------------------------------------------

/** Data payload for the `whatsapp/reminder.send` fan-out event. */
export interface ReminderSendEventData {
  /** Psychologist's auth.users.id */
  userId: string;
  /** Session to remind about */
  sessionId: string;
  /** Patient receiving the reminder */
  patientId: string;
  /** Reminder kind: 'early' | 'final' | 'video' */
  kind: string;
  /** Pre-computed idempotency key (sha256 of sessionId:kind) */
  idempotencyKey: string;
  /** WhatsApp account ID for the psychologist */
  whatsappAccountId: string;
  /** Template key to use (e.g., 'lembrete_24h') */
  templateKey: string;
  /** Patient phone in E.164 format */
  patientPhone: string;
  /** Patient first name */
  patientFirstName: string;
  /** Patient full name */
  patientFullName: string;
  /** Psychologist display name */
  psychologistDisplayName: string;
  /** Session start time (ISO string) */
  sessionStartAt: string;
  /** Session duration in minutes */
  sessionDurationMinutes: number;
  /** Session modality ('in_person' | 'online') */
  sessionModality: string;
  /** Video link (nullable, only for online sessions) */
  videoLink: string | null;
  /** Confirmation link (nullable) */
  confirmationLink: string | null;
  /** Session value (nullable) */
  sessionValue: number | null;
  /** Location name (nullable) */
  locationName: string | null;
  /** Location address (nullable) */
  locationAddress: string | null;
  /** Location arrival instructions (nullable) */
  locationArrivalInstructions: string | null;
  /** Twilio Content SID for the template */
  contentSid: string;
  /** Template body text with placeholders */
  templateBody: string;
}

/** Data payload for `whatsapp/status.updated` — Twilio status webhook. */
export interface StatusUpdatedEventData {
  bspMessageId: string;
  status: string;
  errorCode?: number;
  errorMessage?: string;
}

/** Data payload for `whatsapp/confirmation.received` — patient confirmed. */
export interface ConfirmationReceivedEventData {
  bspMessageId: string;
  sessionId: string;
  patientId: string;
  userId: string;
}

/** Data payload for `whatsapp/cancellation.received` — patient cancelled. */
export interface CancellationReceivedEventData {
  bspMessageId: string;
  sessionId: string;
  patientId: string;
  userId: string;
  message?: string;
}

/** Data payload for `whatsapp/stop.received` — patient opted out (PARAR). */
export interface StopReceivedEventData {
  fromPhone: string;
  patientId: string;
  userId: string;
}

/** Data payload for `whatsapp/inbound.received` — generic inbound message. */
export interface InboundReceivedEventData {
  bspMessageId: string;
  fromPhone: string;
  body: string;
  userId: string;
  patientId?: string;
}

/** Data payload for `whatsapp/confirmation.ack` — confirmation ack sent. */
export interface ConfirmationAckEventData {
  sessionId: string;
  patientId: string;
  userId: string;
}

/** Data payload for `whatsapp/message.persisted` — message saved to DB. */
export interface MessagePersistedEventData {
  /** UUID of the whatsapp_messages row. */
  messageId: string;
  /** Psychologist's auth.users.id. */
  userId: string;
  /** Patient who sent/received the message. */
  patientId: string;
}

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const WHATSAPP_EVENTS = {
  REMINDER_SEND: 'whatsapp/reminder.send',
  STATUS_UPDATED: 'whatsapp/status.updated',
  CONFIRMATION_RECEIVED: 'whatsapp/confirmation.received',
  CANCELLATION_RECEIVED: 'whatsapp/cancellation.received',
  STOP_RECEIVED: 'whatsapp/stop.received',
  INBOUND_RECEIVED: 'whatsapp/inbound.received',
  CONFIRMATION_ACK: 'whatsapp/confirmation.ack',
  MESSAGE_PERSISTED: 'whatsapp/message.persisted',
} as const;

// ---------------------------------------------------------------------------
// Inngest client
// ---------------------------------------------------------------------------

export const inngest = new Inngest({
  id: 'hubrityp',
  middleware: [
    // Encrypts all step output and function results client-side before they
    // reach Inngest Cloud. This prevents raw clinical transcripts, audio
    // base64, and pseudonymized notes from being stored unencrypted outside
    // sa-east-1 (LGPD art. 11 + art. 33 compliance).
    encryptionMiddleware({
      key: serverEnv.INNGEST_ENCRYPTION_KEY,
    }),
  ],
});
