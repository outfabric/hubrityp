/**
 * Recording cleanup cron — Inngest function that periodically discards
 * old video recordings to enforce RNF-09.08 (audio not persisted beyond 24h).
 *
 * Runs every hour. For each qualifying recording:
 *
 *   1. Queries `video_recordings` WHERE status IN ('processing', 'transcribed')
 *      AND `recorded_at < NOW() - INTERVAL '24 hours'`.
 *   2. Updates status='discarded', discarded_at=NOW(), audio_temp_url=NULL.
 *   3. Logs the count of discarded recordings (metadata only, no PII).
 *
 * Uses the Drizzle db client directly (not a Supabase client scoped to a user)
 * because this is a system job running in Inngest, not a user-initiated action.
 * The db client bypasses RLS — justified because there is no user session in
 * background jobs.
 *
 * Retries: 3 with backoff (Inngest default backoff strategy).
 */

import { and, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { videoRecordings } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — `any` schema generic is intentional for testability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface RecordingCleanupDeps {
  db: DrizzleDb;
}

export interface RecordingCleanupResult {
  /** Number of recordings discarded in this run. */
  discardedCount: number;
}

// ---------------------------------------------------------------------------
// Statuses eligible for cleanup
// ---------------------------------------------------------------------------

const CLEANABLE_STATUSES = ['processing', 'transcribed'] as const;

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Discards recordings older than 24 hours that are in a cleanable status.
 * Sets status='discarded', discarded_at=NOW(), audio_temp_url=NULL.
 *
 * Returns the count of discarded recordings.
 */
export async function processRecordingCleanup(
  deps: RecordingCleanupDeps,
): Promise<RecordingCleanupResult> {
  const { db } = deps;

  const cutoff = sql`now() - interval '24 hours'`;

  const discarded = await db
    .update(videoRecordings)
    .set({
      status: 'discarded',
      discardedAt: sql`now()`,
      audioTempUrl: null,
    })
    .where(
      and(
        inArray(videoRecordings.status, [...CLEANABLE_STATUSES]),
        lt(videoRecordings.recordedAt, cutoff),
      ),
    )
    .returning({ id: videoRecordings.id });

  return { discardedCount: discarded.length };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const recordingCleanupCron = inngest.createFunction(
  {
    id: 'telepsicologia-recording-cleanup',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 0 * * * *' }],
    retries: 3,
  },
  async ({ step, logger }) => {
    const result = await step.run('cleanup-recordings', async () => {
      // Lazy import — same pattern as other Inngest functions.
      const { db } = await import('@/shared/db/client');

      return processRecordingCleanup({ db });
    });

    logger.info(
      {
        event: 'recording_cleanup_cron_complete',
        discardedCount: result.discardedCount,
      },
      `Recording cleanup: ${result.discardedCount} recording(s) discarded`,
    );

    return result;
  },
);
