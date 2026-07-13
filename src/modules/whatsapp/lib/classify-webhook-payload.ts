/**
 * Twilio WhatsApp webhook payload classification.
 *
 * Pure, dependency-free logic shared by the webhook Route Handler. Quick-reply
 * button presses are classified by `ButtonPayload` — the button ID we define in
 * the Twilio Content Template Builder — never by `ButtonText`. `ButtonText` is
 * the visible label (display copy that may carry accents or be re-worded) and
 * must never be load-bearing for a state mutation.
 */

/**
 * Quick-reply button IDs (`ButtonPayload`) defined in the Content Template
 * Builder. These are the stable classification contract.
 */
export const BUTTON_ID_CONFIRM = 'confirm';
export const BUTTON_ID_CANCEL = 'cancel';

export type WebhookType =
  | { type: 'status_update' }
  | { type: 'button_confirm' }
  | { type: 'button_cancel' }
  | { type: 'stop_command' }
  | { type: 'inbound_text' };

/** PARAR opt-out — exact match only (trimmed, case-insensitive). */
function isStopCommand(body: string): boolean {
  return body.trim().toUpperCase() === 'PARAR';
}

/**
 * Classifies an inbound Twilio webhook payload into a single event type.
 *
 * Precedence: status callbacks first, then quick-reply buttons (by
 * `ButtonPayload` only), then the PARAR stop command, then a generic inbound
 * text message. An unrecognized `ButtonPayload` is NOT special-cased: it falls
 * through to the stop/inbound checks, so it safely lands in `inbound_text`
 * (which auto-replies and never mutates session state).
 */
export function classifyPayload(params: Record<string, string>): WebhookType {
  // Status callbacks include a MessageStatus field.
  if (params.MessageStatus) {
    return { type: 'status_update' };
  }

  // Quick-reply buttons: classify by ButtonPayload (the button ID), never by
  // ButtonText (display copy). Unrecognized payloads fall through below.
  const buttonPayload = params.ButtonPayload;
  if (buttonPayload === BUTTON_ID_CONFIRM) {
    return { type: 'button_confirm' };
  }
  if (buttonPayload === BUTTON_ID_CANCEL) {
    return { type: 'button_cancel' };
  }

  // PARAR stop command in the Body field.
  const body = params.Body ?? '';
  if (body.length > 0 && isStopCommand(body)) {
    return { type: 'stop_command' };
  }

  // Safe default: generic inbound text (also catches unrecognized ButtonPayload).
  return { type: 'inbound_text' };
}
