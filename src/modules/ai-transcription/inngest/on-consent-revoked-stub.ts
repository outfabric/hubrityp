/**
 * Stub consumer for `ai-transcription/consent.revoked` events.
 *
 * This function exists to prove the event wiring end-to-end. Downstream
 * changes (ai-transcription-gemini-processing) will replace the stub with
 * a real consumer that cancels pending transcription jobs, purges cached
 * audio, and updates the consent status in the transcription pipeline.
 *
 * The log line intentionally omits `reason` — it may contain PII
 * (free-text explanation from the patient/psychologist). Only structural
 * IDs are logged.
 */

import { logger } from '@/shared/lib/logger';

import { inngest } from './client';
import { AI_TRANSCRIPTION_EVENTS, consentRevokedEventSchema } from './events';

// ---------------------------------------------------------------------------
// Core handler logic — extracted for testability
// ---------------------------------------------------------------------------

export interface ConsentRevokedHandlerInput {
  termId: string;
  userId: string;
  patientId: string;
}

/**
 * Processes a consent-revoked event. Logs receipt with structural IDs only.
 * No `reason` in the log line — it may contain PII.
 */
export function handleConsentRevoked(input: ConsentRevokedHandlerInput): void {
  logger.info(
    {
      event: 'ai-transcription/consent.revoked.received',
      termId: input.termId,
      userId: input.userId,
      patientId: input.patientId,
    },
    'received',
  );
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const onConsentRevokedStub = inngest.createFunction(
  {
    id: 'on-consent-revoked-stub',
    triggers: [{ event: AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED }],
  },
  async ({ event, step }) => {
    await step.run('log-consent-revoked', () => {
      // Validate inbound payload at the boundary
      const data = consentRevokedEventSchema.parse(event.data);

      handleConsentRevoked({
        termId: data.termId,
        userId: data.userId,
        patientId: data.patientId,
      });
    });
  },
);
