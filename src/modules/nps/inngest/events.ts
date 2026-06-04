/**
 * Inngest event payload schemas for the nps module.
 *
 * Each schema is the single source of truth for the shape of the corresponding
 * Inngest event payload. The Server Action validates the outbound payload before
 * sending; the downstream Inngest function (detractor follow-up email, built in
 * a later section) validates the inbound payload on receipt.
 */

import { z } from 'zod';

/**
 * `nps/detractor.submitted` — a psychologist submitted a detractor NPS score
 * (0–6).
 *
 * Emitted fire-and-forget by `submitNpsImpl`. The downstream consumer sends the
 * detractor follow-up email via Resend. The payload carries only the internal
 * user id and the score — NEVER the email, name, or free-text feedback (LGPD):
 * the consumer resolves the address itself from the owner-scoped profile row.
 */
export const detractorSubmittedEventSchema = z.object({
  userId: z.string().uuid(),
  score: z.number().int().min(0).max(6),
});
export type DetractorSubmittedEvent = z.infer<typeof detractorSubmittedEventSchema>;

export const NPS_EVENTS = {
  DETRACTOR_SUBMITTED: 'nps/detractor.submitted',
} as const;
