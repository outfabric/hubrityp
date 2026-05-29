'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import type { TranscriptionId } from '../lib/branded-types';
import { createTranscriptionLogger } from '../lib/logger';
import {
  type ListTranscriptionsForReviewResult,
  type TranscriptionListItem,
} from '../lib/review-schemas';
import { TranscriptionStatusSchema } from '../lib/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the patient's first name from the stored full name. The review list
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
 * Lists the authenticated user's transcriptions grouped into the three review
 * buckets the UI renders as tabs: `pending`, `reviewed`, `failed`.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Single owner-scoped SELECT for the three displayable statuses
 *      (`ready`, `reviewed`, `failed`), joined to `patients` for the first
 *      name and left-joined to `sessions` for the session date.
 *   3. Bucket in memory and order each bucket newest-first.
 *
 * Ordering / priority (from the spec): the page renders "Pendentes" first,
 * then "Revisadas", then "Falhas". Within every bucket rows are newest-first
 * (`created_at DESC`), so the most recent work is at the top of each tab.
 *
 * Security:
 *   - `userId` always comes from the session, never from input.
 *   - The query is owner-scoped (`user_id = caller`) as defense-in-depth on
 *     top of RLS (`db` bypasses RLS), so another tenant's rows can never leak.
 *   - The response carries `patientFirstName` (needed by the UI), but the
 *     domain logger redacts it, so no PII reaches log sinks.
 */
export async function listTranscriptionsForReviewImpl(
  supabase: SupabaseClient,
): Promise<ListTranscriptionsForReviewResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // The ai_transcriptions table is imported dynamically — the repo's documented
  // escape hatch from the `require-assert-ai-consent` static-import guard. This
  // is a pure READ of the user's own list; consent is not re-checked here
  // (mirrors `get-transcription-for-review.ts`).
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  // 2. SELECT — owner-scoped, only the displayable statuses, newest-first.
  const rows = await db
    .select({
      id: aiTranscriptions.id,
      status: aiTranscriptions.status,
      templateUsed: aiTranscriptions.templateUsed,
      savedToProntuario: aiTranscriptions.savedToProntuario,
      createdAt: aiTranscriptions.createdAt,
      patientFullName: patients.fullName,
      sessionStartAt: sessions.startAt,
    })
    .from(aiTranscriptions)
    .innerJoin(patients, eq(patients.id, aiTranscriptions.patientId))
    .leftJoin(sessions, eq(sessions.id, aiTranscriptions.sessionId))
    .where(
      and(
        eq(aiTranscriptions.userId, userId),
        inArray(aiTranscriptions.status, ['ready', 'reviewed', 'failed']),
      ),
    )
    .orderBy(desc(aiTranscriptions.createdAt));

  // 3. Bucket in memory. The query already orders newest-first, so push order
  // preserves `created_at DESC` within each bucket.
  const pending: TranscriptionListItem[] = [];
  const reviewed: TranscriptionListItem[] = [];
  const failed: TranscriptionListItem[] = [];

  for (const row of rows) {
    const item: TranscriptionListItem = {
      transcriptionId: row.id as TranscriptionId,
      status: TranscriptionStatusSchema.parse(row.status),
      templateUsed: row.templateUsed,
      patientFirstName: firstNameOf(row.patientFullName),
      sessionDate: row.sessionStartAt ?? null,
      createdAt: row.createdAt,
    };

    if (item.status === 'reviewed') {
      reviewed.push(item);
    } else if (item.status === 'failed') {
      failed.push(item);
    } else if (item.status === 'ready' && !row.savedToProntuario) {
      // A `ready` row that is already saved is effectively reviewed; only
      // unsaved `ready` rows are "pending review".
      pending.push(item);
    }
  }

  log.debug({
    event: 'list_for_review',
    pendingCount: pending.length,
    reviewedCount: reviewed.length,
    failedCount: failed.length,
  });

  return { ok: true, pending, reviewed, failed };
}
