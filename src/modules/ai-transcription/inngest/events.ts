/**
 * Inngest event payload schemas for the ai-transcription module.
 *
 * Each schema is the single source of truth for the shape of the
 * corresponding Inngest event payload. Server Actions validate outbound
 * payloads before sending, and Inngest functions validate inbound
 * payloads on receipt.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const uuidField = z.string().uuid();

// ---------------------------------------------------------------------------
// Event schemas
// ---------------------------------------------------------------------------

/**
 * `ai-transcription/consent.revoked` — a patient's AI consent is revoked.
 *
 * Emitted fire-and-forget by the `revokeAiConsentTermImpl` Server Action.
 * Downstream consumers (stub for now) can use this to clean up any
 * pending transcription jobs for the patient.
 */
export const consentRevokedEventSchema = z.object({
  termId: uuidField,
  userId: uuidField,
  patientId: uuidField,
  revokedAt: z.coerce.date(),
  reason: z.string().max(500).nullable(),
});
export type ConsentRevokedEvent = z.infer<typeof consentRevokedEventSchema>;

export const AI_TRANSCRIPTION_EVENTS = {
  CONSENT_REVOKED: 'ai-transcription/consent.revoked',
} as const;
