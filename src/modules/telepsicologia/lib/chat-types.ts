/**
 * Types for ephemeral in-call chat via Stream custom events.
 *
 * Messages are client-only — stored in React state and discarded when the
 * component unmounts (i.e., when the call ends). No server persistence,
 * no PII in logs, no DB table.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on chat message length to prevent oversized Stream custom event payloads. */
export const MAX_CHAT_MESSAGE_LENGTH = 2_000;

// ---------------------------------------------------------------------------
// ChatMessage — a single ephemeral message in the call chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  /** Client-generated unique id (crypto.randomUUID). */
  id: string;
  /** Display name of the sender (e.g., "Dr. Fulano" or "Paciente"). */
  senderName: string;
  /** Stream user id of the sender. */
  senderId: string;
  /** Message body text. */
  text: string;
  /** ISO 8601 timestamp of when the message was sent. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Custom event payload shape — sent via call.sendCustomEvent({ ... })
//
// The Stream SDK wraps this in CustomVideoEvent.custom. The `type` field
// here is an application-level discriminator (not the SDK event type).
// ---------------------------------------------------------------------------

export interface ChatCustomEventPayload {
  type: 'chat-message';
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: string;
}

/**
 * Custom event payload for broadcasting recording state changes from
 * the psychologist's browser to the patient's browser. Sent via
 * `call.sendCustomEvent()` whenever the psychologist starts or stops
 * recording. The patient listens for this event to display the
 * "session is being recorded" banner (LGPD Art. 9 compliance).
 */
export interface RecordingStateEventPayload {
  type: 'recording-state-changed';
  isRecording: boolean;
}

/**
 * Union of all custom event payloads sent via Stream call custom events.
 * Used when discriminating the `event.custom` field in listeners.
 */
export type CustomEventPayload = ChatCustomEventPayload | RecordingStateEventPayload;
