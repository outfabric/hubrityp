'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import type { TranscriptionId } from '../lib/branded-types';
import { createTranscriptionLogger } from '../lib/logger';
import {
  GeneratedNoteSchema,
  GetTranscriptionForReviewInputSchema,
  RiskAlertSchema,
  type GetTranscriptionForReviewResult,
} from '../lib/review-schemas';
import {
  TranscriptionSourceSchema,
  TranscriptionStatusSchema,
  type GeneratedNote,
  type RiskAlert,
} from '../lib/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the patient's first name from the stored full name. The review UI
 * only ever displays the first name (LGPD data-minimization on screen).
 */
function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Canonical read-for-review query for a single AI transcription.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Zod-validate input (`safeParse`).
 *   3. Drizzle SELECT scoped to the caller: join `ai_transcriptions` ↔
 *      `patients` (inner) ↔ `sessions` (left), WHERE `id = tx AND user_id =
 *      caller` (defense-in-depth on top of RLS — `db` bypasses RLS).
 *   4. No row → `{ ok: false, code: 'NOT_FOUND' }` (also the IDOR answer:
 *      another tenant's id simply does not match the user filter).
 *   5. Validate the `generated_note` / `risk_alerts` JSONB via Zod. On drift,
 *      log `note_schema_drift` (transcriptionId ONLY — no payload, no PII) and
 *      degrade `generatedNote` to `null` / `riskAlerts` to `[]`.
 *
 * Security:
 *   - `userId` always comes from the session, never from input.
 *   - The response carries `patientFirstName` (needed by the UI) but the
 *     domain logger redacts `patientFirstName`/`generatedNote`/`riskAlerts`,
 *     so no PII or clinical content reaches log sinks.
 */
export async function getTranscriptionForReviewImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetTranscriptionForReviewResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // 2. Validate input
  const parsed = GetTranscriptionForReviewInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'get_for_review_validation_failed' });
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { transcriptionId } = parsed.data;

  // Consent note: this is a READ of an already-generated note. A `ready` note
  // survives consent revocation (RN-10.06 — only in-flight rows are cancelled),
  // and the psychologist must still be able to review/discard it. Re-checking
  // consent here would wrongly hide a note the user is responsible for. The
  // table is therefore imported dynamically (the repo's documented escape hatch
  // from the `require-assert-ai-consent` static-import guard, mirroring
  // `on-consent-revoked.ts`).
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  // 3. SELECT — owner-scoped join (patients inner, sessions left)
  const [row] = await db
    .select({
      id: aiTranscriptions.id,
      status: aiTranscriptions.status,
      source: aiTranscriptions.source,
      templateUsed: aiTranscriptions.templateUsed,
      generatedNote: aiTranscriptions.generatedNote,
      riskAlerts: aiTranscriptions.riskAlerts,
      savedToProntuario: aiTranscriptions.savedToProntuario,
      evolutionId: aiTranscriptions.evolutionId,
      errorCode: aiTranscriptions.errorCode,
      createdAt: aiTranscriptions.createdAt,
      completedAt: aiTranscriptions.completedAt,
      patientId: aiTranscriptions.patientId,
      patientFullName: patients.fullName,
      sessionId: aiTranscriptions.sessionId,
      sessionStartAt: sessions.startAt,
    })
    .from(aiTranscriptions)
    .innerJoin(patients, eq(patients.id, aiTranscriptions.patientId))
    .leftJoin(sessions, eq(sessions.id, aiTranscriptions.sessionId))
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)))
    .limit(1);

  if (!row) {
    log.debug({ event: 'get_for_review_not_found', transcriptionId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 5. Validate JSONB payloads (drift detection)
  let generatedNote: GeneratedNote | null = null;
  if (row.generatedNote !== null) {
    const noteParsed = GeneratedNoteSchema.safeParse(row.generatedNote);
    if (noteParsed.success) {
      generatedNote = noteParsed.data;
    } else {
      // Drift: log presence only — never the payload (clinical content).
      log.warn({ event: 'note_schema_drift', transcriptionId });
    }
  }

  let riskAlerts: RiskAlert[] = [];
  if (row.riskAlerts !== null) {
    const alertsParsed = RiskAlertSchema.array().safeParse(row.riskAlerts);
    if (alertsParsed.success) {
      riskAlerts = alertsParsed.data;
    } else {
      log.warn({ event: 'risk_alerts_schema_drift', transcriptionId });
    }
  }

  return {
    ok: true,
    transcriptionId: row.id as TranscriptionId,
    status: TranscriptionStatusSchema.parse(row.status),
    source: TranscriptionSourceSchema.parse(row.source),
    templateUsed: row.templateUsed,
    patientFirstName: firstNameOf(row.patientFullName),
    patientId: row.patientId,
    sessionId: row.sessionId,
    sessionDate: row.sessionStartAt ?? null,
    generatedNote,
    riskAlerts,
    savedToProntuario: row.savedToProntuario,
    evolutionId: row.evolutionId,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
