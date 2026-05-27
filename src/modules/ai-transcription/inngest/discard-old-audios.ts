/**
 * Inngest cron function: `discardOldAudios`
 *
 * Runs every hour (`0 * * * *`). On each tick it queries
 * `ai_transcriptions` for rows where:
 *   - `audio_object_key IS NOT NULL`
 *   - `audio_discarded_at IS NULL`
 *   - `created_at < now() - INTERVAL '<keep_audio_hours> hours'`
 *
 * The retention threshold is per-user: JOIN to `ai_transcription_settings`
 * and use `COALESCE(settings.keep_audio_hours, 24)` as the cutoff.
 *
 * For each qualifying row, in a dedicated `step.run('discard-<id>')`:
 *   1. DELETE the object from Supabase Storage (service-role).
 *   2. UPDATE the row: `audio_object_key = NULL`, `audio_discarded_at = now()`.
 *
 * Service-role justification: this is a system Inngest cron job with no user
 * session. The Storage delete requires service-role because the cron acts on
 * behalf of ALL users — there is no single `auth.uid()` in scope. The Drizzle
 * `db` client bypasses RLS for the same reason (system-scoped batch operation).
 *
 * Error isolation: a Storage delete failure on one row logs the error and
 * continues to the next row — it does not block the batch.
 */

import { createTranscriptionLogger } from '../lib/logger';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

/** Minimal interface for a Storage client capable of deleting objects. */
export interface DiscardStorageClient {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{
        data: { name: string }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** Row shape returned by the discard query. */
export interface DiscardCandidate {
  id: string;
  audioObjectKey: string;
}

/** Dependencies injected for testability. */
export interface DiscardOldAudiosDeps {
  /**
   * Fetches rows eligible for audio discard.
   * Returns transcription ID + audio object key for each qualifying row.
   */
  findCandidates: () => Promise<DiscardCandidate[]>;
  /** Creates a Supabase Storage client (service-role). */
  createStorageClient: () => DiscardStorageClient;
  /** The Storage bucket name. */
  bucket: string;
  /** Updates a row after successful Storage deletion. */
  markDiscarded: (transcriptionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Default dependency factories (production wiring)
// ---------------------------------------------------------------------------

async function defaultFindCandidates(): Promise<DiscardCandidate[]> {
  const { db } = await import('@/shared/db/client');
  const { sql } = await import('drizzle-orm');

  // The query JOINs ai_transcriptions to ai_transcription_settings to get
  // the per-user `keep_audio_hours` (defaulting to 24). The WHERE clause
  // uses the partial index `idx_ai_transcriptions_audio_to_discard` by
  // matching on `audio_object_key IS NOT NULL AND audio_discarded_at IS NULL`.
  const rows = await db.execute<{ id: string; audio_object_key: string }>(
    sql`
      SELECT t.id, t.audio_object_key
      FROM ai_transcriptions t
      LEFT JOIN ai_transcription_settings s ON s.user_id = t.user_id
      WHERE t.audio_object_key IS NOT NULL
        AND t.audio_discarded_at IS NULL
        AND t.created_at < now() - make_interval(hours => COALESCE(s.keep_audio_hours, 24))
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    audioObjectKey: r.audio_object_key,
  }));
}

async function defaultCreateStorageClient(): Promise<DiscardStorageClient> {
  const { createClient } = await import('@supabase/supabase-js');
  const { serverEnv } = await import('@/shared/env');
  const { clientEnv } = await import('@/shared/env/client');

  // Service-role required: no user session in a system cron job.
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY);
}

async function defaultMarkDiscarded(transcriptionId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { eq } = await import('drizzle-orm');
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  await db
    .update(aiTranscriptions)
    .set({
      audioObjectKey: null,
      audioDiscardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiTranscriptions.id, transcriptionId));
}

async function defaultBucket(): Promise<string> {
  const { serverEnv } = await import('@/shared/env');
  return serverEnv.AI_TRANSCRIPTION_BUCKET;
}

// ---------------------------------------------------------------------------
// Core logic — exported for unit testability
// ---------------------------------------------------------------------------

export interface DiscardBatchResult {
  processed: number;
  discarded: number;
  failed: number;
}

/**
 * Processes a single candidate: delete from Storage then mark discarded in DB.
 *
 * Returns `true` on success, `false` on failure (logged, never thrown).
 */
export async function discardOneAudio(
  candidate: DiscardCandidate,
  storageClient: DiscardStorageClient,
  bucket: string,
  markDiscarded: (id: string) => Promise<void>,
  log: ReturnType<typeof createTranscriptionLogger>,
): Promise<boolean> {
  try {
    const { error } = await storageClient.storage.from(bucket).remove([candidate.audioObjectKey]);

    if (error) {
      log.error(
        {
          event: 'audio_discard_storage_error',
          transcriptionId: candidate.id,
          error: error.message,
        },
        'Storage delete failed for audio discard',
      );
      return false;
    }

    await markDiscarded(candidate.id);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error(
      { event: 'audio_discard_row_error', transcriptionId: candidate.id, error: msg },
      'Failed to discard audio for row',
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const discardOldAudios = inngest.createFunction(
  {
    id: 'discard-old-audios',
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }): Promise<DiscardBatchResult> => {
    const log = createTranscriptionLogger({});
    const startMs = Date.now();

    // Step 1: find all candidates in a single query
    const candidates = await step.run('find-candidates', async () => {
      return defaultFindCandidates();
    });

    if (candidates.length === 0) {
      log.info(
        { event: 'audio_discard_batch', count: 0, duration: Date.now() - startMs },
        'No audios eligible for discard',
      );
      return { processed: 0, discarded: 0, failed: 0 };
    }

    // Resolve the bucket name once (serializable through step boundaries).
    // The Storage client itself is created fresh inside each per-row step
    // because it is not JSON-serializable.
    const bucket = await step.run('init-deps', async () => {
      return defaultBucket();
    });

    // Step N: discard each row in its own step for idempotency + isolation
    let discarded = 0;
    let failed = 0;

    for (const candidate of candidates) {
      const success = await step.run(`discard-${candidate.id}`, async () => {
        // Create a fresh storage client inside the step (step results must be serializable)
        const client = await defaultCreateStorageClient();
        return discardOneAudio(candidate, client, bucket, defaultMarkDiscarded, log);
      });

      if (success) {
        discarded++;
      } else {
        failed++;
      }
    }

    const duration = Date.now() - startMs;
    log.info(
      { event: 'audio_discard_batch', count: discarded, failed, duration },
      `Audio discard batch complete: ${discarded} discarded, ${failed} failed`,
    );

    return { processed: candidates.length, discarded, failed };
  },
);
