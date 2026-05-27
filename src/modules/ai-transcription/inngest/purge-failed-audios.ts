/**
 * Inngest cron function: `purgeFailedAudios`
 *
 * Runs at minute 15 of every hour (`15 * * * *`), offset from
 * `discardOldAudios` at minute 0 to avoid contention.
 *
 * Shortens retention for terminal failures. On each tick it queries
 * `ai_transcriptions` for rows where:
 *   - `status IN ('failed', 'cancelled')`
 *   - `audio_object_key IS NOT NULL`
 *   - `COALESCE(completed_at, updated_at) < now() - INTERVAL '1 hour'`
 *
 * For each qualifying row, in a dedicated `step.run('purge-<id>')`:
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
export interface PurgeStorageClient {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{
        data: { name: string }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** Row shape returned by the purge query. */
export interface PurgeCandidate {
  id: string;
  audioObjectKey: string;
}

/** Dependencies injected for testability. */
export interface PurgeFailedAudiosDeps {
  /** Fetches rows eligible for audio purge (terminal failures older than 1h). */
  findCandidates: () => Promise<PurgeCandidate[]>;
  /** Creates a Supabase Storage client (service-role). */
  createStorageClient: () => PurgeStorageClient;
  /** The Storage bucket name. */
  bucket: string;
  /** Updates a row after successful Storage deletion. */
  markPurged: (transcriptionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Default dependency factories (production wiring)
// ---------------------------------------------------------------------------

async function defaultFindCandidates(): Promise<PurgeCandidate[]> {
  const { db } = await import('@/shared/db/client');
  const { sql } = await import('drizzle-orm');

  // Terminal failures (status IN ('failed','cancelled')) with audio still
  // present, where the terminal timestamp is older than 1 hour. Uses
  // COALESCE(completed_at, updated_at) because cancelled rows may not
  // have completed_at set.
  const rows = await db.execute<{ id: string; audio_object_key: string }>(
    sql`
      SELECT id, audio_object_key
      FROM ai_transcriptions
      WHERE status IN ('failed', 'cancelled')
        AND audio_object_key IS NOT NULL
        AND COALESCE(completed_at, updated_at) < now() - INTERVAL '1 hour'
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    audioObjectKey: r.audio_object_key,
  }));
}

async function defaultCreateStorageClient(): Promise<PurgeStorageClient> {
  const { createClient } = await import('@supabase/supabase-js');
  const { serverEnv } = await import('@/shared/env');
  const { clientEnv } = await import('@/shared/env/client');

  // Service-role required: no user session in a system cron job.
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY);
}

async function defaultMarkPurged(transcriptionId: string): Promise<void> {
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

export interface PurgeBatchResult {
  processed: number;
  purged: number;
  failed: number;
}

/**
 * Processes a single candidate: delete from Storage then mark purged in DB.
 *
 * Returns `true` on success, `false` on failure (logged, never thrown).
 */
export async function purgeOneAudio(
  candidate: PurgeCandidate,
  storageClient: PurgeStorageClient,
  bucket: string,
  markPurged: (id: string) => Promise<void>,
  log: ReturnType<typeof createTranscriptionLogger>,
): Promise<boolean> {
  try {
    const { error } = await storageClient.storage.from(bucket).remove([candidate.audioObjectKey]);

    if (error) {
      log.error(
        {
          event: 'audio_purge_storage_error',
          transcriptionId: candidate.id,
          error: error.message,
        },
        'Storage delete failed for failed audio purge',
      );
      return false;
    }

    await markPurged(candidate.id);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error(
      { event: 'audio_purge_row_error', transcriptionId: candidate.id, error: msg },
      'Failed to purge audio for row',
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const purgeFailedAudios = inngest.createFunction(
  {
    id: 'purge-failed-audios',
    triggers: [{ cron: '15 * * * *' }],
  },
  async ({ step }): Promise<PurgeBatchResult> => {
    const log = createTranscriptionLogger({});
    const startMs = Date.now();

    // Step 1: find all candidates in a single query
    const candidates = await step.run('find-candidates', async () => {
      return defaultFindCandidates();
    });

    if (candidates.length === 0) {
      log.info(
        { event: 'audio_purge_batch', count: 0, duration: Date.now() - startMs },
        'No failed audios eligible for purge',
      );
      return { processed: 0, purged: 0, failed: 0 };
    }

    // Resolve the bucket name once (serializable through step boundaries).
    // The Storage client itself is created fresh inside each per-row step
    // because it is not JSON-serializable.
    const bucket = await step.run('init-deps', async () => {
      return defaultBucket();
    });

    // Step N: purge each row in its own step for idempotency + isolation
    let purged = 0;
    let failed = 0;

    for (const candidate of candidates) {
      const success = await step.run(`purge-${candidate.id}`, async () => {
        // Create a fresh storage client inside the step (step results must be serializable)
        const client = await defaultCreateStorageClient();
        return purgeOneAudio(candidate, client, bucket, defaultMarkPurged, log);
      });

      if (success) {
        purged++;
      } else {
        failed++;
      }
    }

    const duration = Date.now() - startMs;
    log.info(
      { event: 'audio_purge_batch', count: purged, failed, duration },
      `Failed audio purge batch complete: ${purged} purged, ${failed} failed`,
    );

    return { processed: candidates.length, purged, failed };
  },
);
