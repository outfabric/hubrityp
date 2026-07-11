import { TEMPLATE_LABELS } from './template-labels';

/**
 * Human-readable label for a `template_key`.
 *
 * Falls back to the raw key for historical values that predate the current
 * template enum (e.g. `confirmacao_recebida`, which is no longer a registered
 * template key but may still be stored on older `whatsapp_messages` rows).
 */
export function templateKeyLabel(templateKey: string): string {
  return TEMPLATE_LABELS[templateKey] ?? templateKey;
}

/**
 * Derives the text to render for a `whatsapp_messages` row.
 *
 * Template sends store `body = null` (design D7 — the FTS index uses
 * `coalesce(body, '')`); for those we surface the `TEMPLATE_LABELS` label
 * (raw-key fallback for historical values). Free-form replies carry `body`
 * text and render it unchanged.
 */
export function deriveMessageDisplay(message: {
  body: string | null;
  templateKey: string | null;
}): string {
  if (message.body !== null && message.body.length > 0) {
    return message.body;
  }
  if (message.templateKey !== null && message.templateKey.length > 0) {
    return templateKeyLabel(message.templateKey);
  }
  return '';
}
