import { z } from 'zod';

// ---------------------------------------------------------------------------
// Stats view schema
// ---------------------------------------------------------------------------
//
// Shape returned by `getTranscriptionStats` (spec: ai-transcription-settings).
// Used to type the read; the values are aggregates derived from
// `ai_transcriptions` rows owned by the session user (RLS-scoped, never another
// tenant's data).

/**
 * Aggregate usage metrics for the AI-transcription feature, scoped to one
 * psychologist.
 *
 * - `estimatedMinutesSaved` = `monthProcessed * 8` (RF-10.23).
 * - `acceptanceRatePercent` is `null` until at least 5 transcriptions have been
 *   reviewed (too few samples to be meaningful); otherwise
 *   `100 * saved_without_edits / reviewed`.
 * - `avgCostUsd` is `null` when no completed row carries cost metadata;
 *   otherwise `avg(transcription_cost_usd + llm_cost_usd)` over completed rows.
 */
export const TranscriptionStatsViewSchema = z.object({
  totalProcessed: z.number().int().nonnegative(),
  monthProcessed: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  savedToProntuario: z.number().int().nonnegative(),
  estimatedMinutesSaved: z.number().int().nonnegative(),
  acceptanceRatePercent: z.number().min(0).max(100).nullable(),
  avgCostUsd: z.number().nonnegative().nullable(),
  failedCount: z.number().int().nonnegative(),
});
export type TranscriptionStatsView = z.infer<typeof TranscriptionStatsViewSchema>;
