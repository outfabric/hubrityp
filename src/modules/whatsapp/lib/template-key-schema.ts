/**
 * Template key schema — Zod enum of the five fixed WhatsApp template types.
 *
 * These keys map 1:1 to the `template_key` column in `message_templates`
 * and the CHECK constraint in the database. Psychologists cannot create
 * new template types — they can only edit the body of these five.
 *
 * `confirmacao_recebida` is intentionally absent: in the shared-number MVP the
 * confirmation acknowledgment is a free-form message (Option B), not a template
 * type, so it carries no `template_key`, no label, and no dictionary entry.
 *
 * @see PRD RF-04.06, RF-04.07
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const templateKeySchema = z.enum(
  ['lembrete_24h', 'lembrete_2h', 'cancelamento_aviso', 'link_video', 'termo_consentimento'],
  { message: 'Tipo de template inválido.' },
);

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type TemplateKey = z.infer<typeof templateKeySchema>;
