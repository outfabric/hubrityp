/**
 * Real consumer for `ai-transcription/consent.revoked` events.
 *
 * Replaces the stub from `ai-transcription-consent`. When a patient's AI
 * consent is revoked:
 *
 * 1. SELECT `ai_transcriptions` WHERE user_id + patient_id AND status IN
 *    ('pending', 'transcribing', 'generating').
 * 2. For each row:
 *    - `pending` → UPDATE status = 'cancelled', error_code = 'consent_revoked',
 *      updated_at = now(). The `purgeFailedAudios` cron picks it up within 1h.
 *    - `transcribing` | `generating` → log `consent_revoked_mid_processing`
 *      with transcriptionId only; let the pipeline finish (RN-10.06).
 *
 * Service-role justification: this is a system Inngest job triggered by an
 * internal event. There is no user session in scope. The Drizzle `db` client
 * bypasses RLS; ownership is scoped via the trusted event payload (userId +
 * patientId) — never from external/untrusted input.
 *
 * Log lines intentionally omit `reason` — it may contain PII (free-text
 * explanation from the patient/psychologist). Only structural IDs are logged.
 */

import { createTranscriptionLogger } from '../lib/logger';

import { inngest } from './client';
import { AI_TRANSCRIPTION_EVENTS, consentRevokedEventSchema } from './events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a transcription row relevant to consent revocation. */
export interface ConsentRevokedCandidate {
  id: string;
  status: string;
}

/** Result returned by the handler for observability. */
export interface ConsentRevokedResult {
  cancelled: number;
  skippedMidProcessing: number;
}

// ---------------------------------------------------------------------------
// Core handler logic — extracted for testability
// ---------------------------------------------------------------------------

export interface HandleConsentRevokedDeps {
  /** Fetches in-flight transcription rows for this user+patient. */
  findInFlightRows: (userId: string, patientId: string) => Promise<ConsentRevokedCandidate[]>;
  /** Cancels a pending transcription row. */
  cancelPendingRow: (transcriptionId: string, userId: string) => Promise<void>;
}

/**
 * Processes a consent-revoked event:
 * - Cancels `pending` rows.
 * - Logs but does NOT interrupt `transcribing`/`generating` rows (RN-10.06).
 */
export async function handleConsentRevoked(
  input: { userId: string; patientId: string },
  deps: HandleConsentRevokedDeps,
): Promise<ConsentRevokedResult> {
  const log = createTranscriptionLogger({ userId: input.userId });

  const rows = await deps.findInFlightRows(input.userId, input.patientId);

  let cancelled = 0;
  let skippedMidProcessing = 0;

  for (const row of rows) {
    if (row.status === 'pending') {
      await deps.cancelPendingRow(row.id, input.userId);
      cancelled++;

      log.info(
        { event: 'consent_revoked_pending_cancelled', transcriptionId: row.id },
        'Pending transcription cancelled due to consent revocation',
      );
    } else {
      // status is 'transcribing' or 'generating' — let it finish (RN-10.06)
      skippedMidProcessing++;

      log.info(
        { event: 'consent_revoked_mid_processing', transcriptionId: row.id },
        'Transcription in progress — consent revoked but not interrupting',
      );
    }
  }

  log.info(
    {
      event: 'consent_revoked_processed',
      userId: input.userId,
      patientId: input.patientId,
      totalRows: rows.length,
      cancelled,
      skippedMidProcessing,
    },
    'Consent revocation handler complete',
  );

  return { cancelled, skippedMidProcessing };
}

// ---------------------------------------------------------------------------
// Default dependency factories (production wiring)
// ---------------------------------------------------------------------------

async function defaultFindInFlightRows(
  userId: string,
  patientId: string,
): Promise<ConsentRevokedCandidate[]> {
  const { db } = await import('@/shared/db/client');
  const { and, eq, inArray } = await import('drizzle-orm');
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  const rows = await db
    .select({ id: aiTranscriptions.id, status: aiTranscriptions.status })
    .from(aiTranscriptions)
    .where(
      and(
        eq(aiTranscriptions.userId, userId),
        eq(aiTranscriptions.patientId, patientId),
        inArray(aiTranscriptions.status, ['pending', 'transcribing', 'generating']),
      ),
    );

  return rows;
}

async function defaultCancelPendingRow(transcriptionId: string, userId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { and, eq } = await import('drizzle-orm');
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  await db
    .update(aiTranscriptions)
    .set({
      status: 'cancelled',
      errorCode: 'consent_revoked',
      updatedAt: new Date(),
    })
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const onConsentRevoked = inngest.createFunction(
  {
    id: 'on-consent-revoked',
    triggers: [{ event: AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED }],
  },
  async ({ event, step }) => {
    // Validate inbound payload at the boundary
    const data = consentRevokedEventSchema.parse(event.data);

    const result = await step.run('process-consent-revocation', async () => {
      return handleConsentRevoked(
        { userId: data.userId, patientId: data.patientId },
        {
          findInFlightRows: defaultFindInFlightRows,
          cancelPendingRow: defaultCancelPendingRow,
        },
      );
    });

    return result;
  },
);
