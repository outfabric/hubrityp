/**
 * Types for ephemeral in-call chat via Stream custom events.
 *
 * Messages are client-only — stored in React state and discarded when the
 * component unmounts (i.e., when the call ends). No server persistence,
 * no PII in logs, no DB table.
 */

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
