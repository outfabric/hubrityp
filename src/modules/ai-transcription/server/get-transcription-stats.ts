import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

import { createTranscriptionLogger } from '../lib/logger';
import { TranscriptionStatsViewSchema, type TranscriptionStatsView } from '../lib/stats-schemas';

// RF-10.23: each processed transcription is credited with ~8 minutes of manual
// note-writing saved.
const MINUTES_SAVED_PER_TRANSCRIPTION = 8;

// Acceptance rate is statistically meaningless on a tiny sample, so it is
// withheld (null) until at least this many transcriptions have been reviewed.
const MIN_REVIEWED_FOR_ACCEPTANCE = 5;

export type GetTranscriptionStatsResult =
  | ({ ok: true } & TranscriptionStatsView)
  | { ok: false; code: 'UNAUTHORIZED' };

/**
 * Computes aggregate usage metrics for the AI-transcription feature, scoped to
 * the caller.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Four independent owner-scoped aggregate queries run in parallel
 *      (`Promise.all`): lifetime counts, current-month count, review/save
 *      counts, and average cost. No waterfalls.
 *   3. Derive `estimatedMinutesSaved` (RF-10.23) and `acceptanceRatePercent`
 *      (withheld when `reviewed < 5`).
 *
 * Security: every query is scoped via `user_id = session.uid` — defense in
 * depth on top of RLS (`db` bypasses RLS). The result carries only aggregate
 * numbers, never any patient/clinical content.
 */
export async function getTranscriptionStatsImpl(
  supabase: SupabaseClient,
): Promise<GetTranscriptionStatsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // Start of the current calendar month (UTC). `created_at` is timestamptz; the
  // comparison is inclusive of the first instant of the month.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Consent note: this is a pure aggregate read of owner-scoped *counts* and
  // *averages* — it never returns clinical content, a patient id, or a single
  // transcription's payload, so there is no per-patient consent decision to
  // gate. The table is therefore imported dynamically (the repo's documented
  // escape hatch from the `require-assert-ai-consent` static-import guard,
  // mirroring the other read-only actions in this module).
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  // 2. Four parallel owner-scoped aggregates.
  const [[counts], [monthRow], [reviewRow], [costRow]] = await Promise.all([
    // (a) Lifetime totals: every row, and how many failed.
    db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${aiTranscriptions.status} = 'failed')::int`,
      })
      .from(aiTranscriptions)
      .where(eq(aiTranscriptions.userId, userId)),

    // (b) Rows created in the current month.
    db
      .select({ month: sql<number>`count(*)::int` })
      .from(aiTranscriptions)
      .where(and(eq(aiTranscriptions.userId, userId), gte(aiTranscriptions.createdAt, monthStart))),

    // (c) Review/save counts. `acceptedWithoutEdits` = saved with zero edits,
    //     the numerator of the acceptance rate.
    db
      .select({
        reviewed: sql<number>`count(*) filter (where ${aiTranscriptions.status} = 'reviewed')::int`,
        saved: sql<number>`count(*) filter (where ${aiTranscriptions.savedToProntuario})::int`,
        acceptedWithoutEdits: sql<number>`count(*) filter (where ${aiTranscriptions.savedToProntuario} and ${aiTranscriptions.userEditsCount} = 0)::int`,
      })
      .from(aiTranscriptions)
      .where(eq(aiTranscriptions.userId, userId)),

    // (d) Average total cost (transcription + LLM) over rows carrying cost
    //     metadata. NULL when no row has a cost. `numeric` → text via Drizzle,
    //     so cast to double precision for a JS number.
    db
      .select({
        avgCost: sql<
          number | null
        >`avg(coalesce(${aiTranscriptions.transcriptionCostUsd}, 0) + coalesce(${aiTranscriptions.llmCostUsd}, 0))::double precision`,
      })
      .from(aiTranscriptions)
      .where(
        and(
          eq(aiTranscriptions.userId, userId),
          sql`(${aiTranscriptions.transcriptionCostUsd} is not null or ${aiTranscriptions.llmCostUsd} is not null)`,
        ),
      ),
  ]);

  const totalProcessed = counts?.total ?? 0;
  const failedCount = counts?.failed ?? 0;
  const monthProcessed = monthRow?.month ?? 0;
  const reviewed = reviewRow?.reviewed ?? 0;
  const savedToProntuario = reviewRow?.saved ?? 0;
  const acceptedWithoutEdits = reviewRow?.acceptedWithoutEdits ?? 0;
  const avgCostUsd = costRow?.avgCost ?? null;

  // 3. Derived fields.
  const estimatedMinutesSaved = monthProcessed * MINUTES_SAVED_PER_TRANSCRIPTION;

  const acceptanceRatePercent =
    reviewed >= MIN_REVIEWED_FOR_ACCEPTANCE
      ? Math.round((acceptedWithoutEdits / reviewed) * 100)
      : null;

  const view = TranscriptionStatsViewSchema.parse({
    totalProcessed,
    monthProcessed,
    reviewed,
    savedToProntuario,
    estimatedMinutesSaved,
    acceptanceRatePercent,
    avgCostUsd,
    failedCount,
  });

  log.debug({ event: 'get_stats_success' });
  return { ok: true, ...view };
}
