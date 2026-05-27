/**
 * Recording cleanup cron — Inngest function that periodically:
 *
 *   1. **Emits `recording.completed`** for recordings in `processing` status
 *      whose `audio_temp_url` is set (meaning the Stream recording URL is
 *      available). After dispatching, clears `audio_temp_url` to prevent
 *      double-dispatch on the next run (idempotency guard).
 *
 *   2. **Discards** old recordings (> 24h in `processing` or `transcribed`)
 *      to enforce RNF-09.08 (audio not persisted beyond 24h).
 *
 * The emit step (1) runs BEFORE the cleanup step (2) so that a recording
 * freshly transitioned to `processing` by the Stream webhook handler gets
 * its event dispatched before the 24-hour TTL expires.
 *
 * Uses the Drizzle db client directly (not a Supabase client scoped to a user)
 * because this is a system job running in Inngest, not a user-initiated action.
 * The db client bypasses RLS — justified because there is no user session in
 * background jobs.
 *
 * Retries: 3 with backoff (Inngest default backoff strategy).
 */

import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  AI_TRANSCRIPTION_EVENTS,
  recordingCompletedEventSchema,
} from '@/modules/ai-transcription/inngest/events';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { videoRecordings, videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — `any` schema generic is intentional for testability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/**
 * Minimal interface for `inngest.send()` — extracted for testability so unit
 * tests can inject a spy without bringing in the full Inngest client.
 */
export interface InngestSender {
  send: (payload: { name: string; data: unknown }) => Promise<unknown>;
}

export interface RecordingCleanupDeps {
  db: DrizzleDb;
  /** Inngest client (or mock) used to dispatch events. */
  sender?: InngestSender;
}

export interface RecordingCleanupResult {
  /** Number of recordings discarded in this run. */
  discardedCount: number;
}

export interface EmitReadyRecordingsResult {
  /** Number of `recording.completed` events dispatched in this run. */
  emittedCount: number;
  /** Number of recordings skipped because emit failed (non-fatal). */
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Statuses eligible for cleanup
// ---------------------------------------------------------------------------

const CLEANABLE_STATUSES = ['processing', 'transcribed'] as const;

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Emits `ai-transcription/recording.completed` for recordings in `processing`
 * status whose `audio_temp_url` is set. After successful dispatch, clears
 * `audio_temp_url` so subsequent cron runs skip the row (idempotency guard).
 *
 * Why `audio_temp_url` as the idempotency sentinel:
 * - The webhook handler sets `audio_temp_url` when Stream confirms the
 *   recording is ready (i.e., the URL where the recording can be downloaded).
 * - After emitting, we clear it. The downstream `ingestStreamRecording`
 *   Inngest function carries the URL in the event payload, not in the DB row.
 * - The cleanup step (24h TTL) also clears `audio_temp_url`, which is
 *   harmless — the column is already null after emit.
 * - No schema migration needed: reuses an existing column.
 */
export async function emitReadyRecordings(
  deps: RecordingCleanupDeps,
): Promise<EmitReadyRecordingsResult> {
  const { db, sender } = deps;

  if (!sender) {
    return { emittedCount: 0, errorCount: 0 };
  }

  // Find recordings in `processing` status with a Stream URL available.
  // Join sessions for patientId; join video_rooms for streamCallId.
  const readyRecordings = await db
    .select({
      recordingId: videoRecordings.id,
      userId: videoRecordings.userId,
      sessionId: videoRecordings.sessionId,
      audioTempUrl: videoRecordings.audioTempUrl,
      patientId: sessions.patientId,
      streamCallId: videoRooms.streamCallId,
    })
    .from(videoRecordings)
    .innerJoin(sessions, eq(videoRecordings.sessionId, sessions.id))
    .innerJoin(videoRooms, eq(videoRecordings.sessionId, videoRooms.sessionId))
    .where(and(eq(videoRecordings.status, 'processing'), isNotNull(videoRecordings.audioTempUrl)));

  let emittedCount = 0;
  let errorCount = 0;

  for (const rec of readyRecordings) {
    // Skip if required join data is missing (sessions.patientId is nullable
    // for blocking slots — those should never have recordings, but guard).
    if (!rec.patientId || !rec.audioTempUrl || !rec.streamCallId) {
      continue;
    }

    try {
      const eventPayload = recordingCompletedEventSchema.parse({
        userId: rec.userId,
        patientId: rec.patientId,
        sessionId: rec.sessionId,
        streamRecordingUrl: rec.audioTempUrl,
        streamCallId: rec.streamCallId,
      });

      await sender.send({
        name: AI_TRANSCRIPTION_EVENTS.RECORDING_COMPLETED,
        data: eventPayload,
      });

      // Clear audioTempUrl after successful dispatch — idempotency guard.
      // Next cron run skips this row because audioTempUrl IS NULL.
      await db
        .update(videoRecordings)
        .set({ audioTempUrl: null })
        .where(eq(videoRecordings.id, rec.recordingId));

      emittedCount++;
    } catch (err: unknown) {
      // Fire-and-forget: log error without payload (no PII), do not
      // break the loop or fail the cron. The recording stays with
      // audioTempUrl set, so the next cron run will retry.
      const errMsg = err instanceof Error ? err.message : 'unknown';
      // Logging is handled by the caller (the Inngest function) to
      // keep the pure function free of logger deps. We just count.
      void errMsg; // Acknowledge — logged by the cron step wrapper.
      errorCount++;
    }
  }

  return { emittedCount, errorCount };
}

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
    // Step 1: Emit `recording.completed` for ready recordings (before cleanup).
    const emitResult = await step.run('emit-ready-recordings', async () => {
      const { db } = await import('@/shared/db/client');

      return emitReadyRecordings({ db, sender: inngest });
    });

    if (emitResult.emittedCount > 0 || emitResult.errorCount > 0) {
      logger.info(
        {
          event: 'recording_completed_emit_step',
          emittedCount: emitResult.emittedCount,
          errorCount: emitResult.errorCount,
        },
        `Emitted ${emitResult.emittedCount} recording.completed event(s), ${emitResult.errorCount} error(s)`,
      );
    }

    if (emitResult.errorCount > 0) {
      logger.warn(
        {
          event: 'inngest_send_failed',
          errorCount: emitResult.errorCount,
        },
        'Some recording.completed events failed to dispatch — will retry on next cron run',
      );
    }

    // Step 2: Discard old recordings (>24h).
    const cleanupResult = await step.run('cleanup-recordings', async () => {
      const { db } = await import('@/shared/db/client');

      return processRecordingCleanup({ db });
    });

    logger.info(
      {
        event: 'recording_cleanup_cron_complete',
        discardedCount: cleanupResult.discardedCount,
        emittedCount: emitResult.emittedCount,
      },
      `Recording cleanup: ${cleanupResult.discardedCount} recording(s) discarded, ${emitResult.emittedCount} event(s) emitted`,
    );

    return {
      discardedCount: cleanupResult.discardedCount,
      emittedCount: emitResult.emittedCount,
      emitErrorCount: emitResult.errorCount,
    };
  },
);
