/**
 * Auto-reply constants and throttle rule for inbound free-text WhatsApp
 * messages on the shared platform number.
 *
 * When a patient sends a free-form message to the platform's WhatsApp
 * number, the system replies once with a fixed, non-clinical string
 * telling them this channel only sends reminders. The reply is sent
 * free-form inside Meta's 24-hour customer-service window (opened by the
 * patient's own inbound message), so no approved template is required.
 *
 * This module is intentionally dependency-free (no DB, no Twilio) so the
 * throttle rule and the fixed body can be unit-tested in isolation.
 */

/**
 * Fixed, non-clinical auto-reply body. It contains no PII and no template
 * placeholders — the same static string is sent to every patient.
 */
export const AUTO_REPLY_BODY =
  'Olá, esse canal é utilizado apenas para envio de lembretes. Para falar com seu psicólogo (a), entre em contato diretamente com ele.';

/**
 * Label stored in `whatsapp_messages.template_key` for outbound auto-replies.
 * Used to identify prior auto-replies when evaluating the throttle window.
 * `whatsapp_messages.template_key` has no CHECK constraint (unlike
 * `message_templates.template_key`), so a synthetic label is allowed here.
 */
export const AUTO_REPLY_TEMPLATE_KEY = 'auto_reply';

/** Throttle window: at most one auto-reply per phone per 24 hours. */
export const AUTO_REPLY_THROTTLE_MS = 24 * 60 * 60 * 1000;

/**
 * Decides whether an auto-reply may be sent to a phone, given the timestamp
 * of the most recent auto-reply already sent to it (or `null` if none).
 *
 * Rules:
 *   - No prior auto-reply → allowed.
 *   - Prior auto-reply within the last 24h → suppressed (prevents loops/spam).
 *   - Prior auto-reply 24h or more ago → allowed again.
 */
export function shouldSendAutoReply(lastAutoReplyAt: Date | null, now: Date): boolean {
  if (lastAutoReplyAt === null) {
    return true;
  }
  return now.getTime() - lastAutoReplyAt.getTime() >= AUTO_REPLY_THROTTLE_MS;
}
