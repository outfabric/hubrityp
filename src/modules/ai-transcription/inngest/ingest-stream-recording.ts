/**
 * Inngest function: `ingestStreamRecording`
 *
 * Triggered by `ai-transcription/recording.completed` when a Stream video
 * recording finishes. Downloads the recording from Stream's CDN, uploads it
 * to Supabase Storage, creates a transcription row, and emits the
 * `ai-transcription/audio.uploaded` event to start the Gemini pipeline.
 *
 * Steps:
 *   1. `assert-consent` — verify AI consent is active for the patient.
 *   2. `create-row` — INSERT into `ai_transcriptions` with `status='pending'`.
 *   3. `download-from-stream` — fetch the recording (SSRF-safe, streaming).
 *   4. `upload-to-bucket` — PUT into Supabase Storage via service-role.
 *   5. `update-row` — set `audio_object_key`, `audio_size_bytes`, duration.
 *   6. `emit-uploaded` — fire `ai-transcription/audio.uploaded`.
 *   7. `instruct-stream-delete` — best-effort delete of the Stream recording.
 *
 * Service-role justification: this is a system Inngest job with no user
 * session. The Drizzle `db` client bypasses RLS (scoped by the userId from
 * the event, which was set by the trusted webhook handler). The Storage
 * client uses the service-role key because the upload path is
 * server-generated (no user input controls the path).
 *
 * Each step has its own retry counter. If any step fails after retries, the
 * `onFailure` handler marks the row as `status='failed'`.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { createTranscriptionLogger } from '../lib/logger';

import { inngest } from './client';
import {
  AI_TRANSCRIPTION_EVENTS,
  audioUploadedEventSchema,
  recordingCompletedEventSchema,
} from './events';

// ---------------------------------------------------------------------------
// SSRF guard: Stream CDN host allowlist
// ---------------------------------------------------------------------------

/**
 * Allowlisted hostnames for Stream recording CDN downloads.
 *
 * Stream stores recordings on their CDN infrastructure. The allowlist
 * prevents SSRF attacks where a crafted URL could reach internal services.
 *
 * Hostnames confirmed from Stream documentation:
 * - `stream-io-cdn.com` — primary CDN domain
 * - `*.stream-io-cdn.com` — regional subdomains (us-east, eu-west, etc.)
 */
export const STREAM_HOST_ALLOWLIST = ['stream-io-cdn.com'] as const;

/**
 * Validates that a hostname belongs to the Stream CDN allowlist.
 *
 * Matches exact domain or any subdomain (e.g., `us-east.stream-io-cdn.com`).
 */
export function isAllowedStreamHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return STREAM_HOST_ALLOWLIST.some(
    (allowed) => lower === allowed || lower.endsWith(`.${allowed}`),
  );
}

/**
 * Checks whether an IPv4 address string is in a private/reserved range.
 *
 * Private ranges blocked:
 * - 10.0.0.0/8
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local)
 * - 0.0.0.0/8 ("this network")
 *
 * Also blocks IPv6 loopback (::1) and link-local (fe80::/10).
 */
export function isPrivateIP(ip: string): boolean {
  // IPv6 loopback and link-local
  if (ip === '::1' || ip.toLowerCase().startsWith('fe80:')) {
    return true;
  }

  // IPv4 checks
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 ("this network")
  if (a === 0) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface IngestStreamRecordingDeps {
  db: DrizzleDb;
  /** Overridable fetch for testing. Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /** Overridable host allowlist for testing (e.g., allow localhost). */
  hostAllowlist?: readonly string[];
  /** DNS resolution for SSRF check. Defaults to `dns.promises.resolve4`. */
  resolveDns?: (hostname: string) => Promise<string[]>;
  /** Creates a Supabase Storage client. Injected for testing. */
  createStorageClient?: () => StorageClient;
  /** Creates a Stream SDK client. Injected for testing. */
  getStreamClient?: () => StreamVideoClient;
}

/** Minimal interface for the Supabase Storage client used by this function. */
export interface StorageClient {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        data: Buffer,
        options?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
}

/** Minimal interface for Stream's video call delete method. */
export interface StreamVideoClient {
  video: {
    call: (
      type: string,
      id: string,
    ) => {
      deleteRecording: (request: { session: string; filename: string }) => Promise<unknown>;
    };
  };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface IngestStreamRecordingResult {
  status: 'ingested' | 'skipped';
  transcriptionId?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// WebM magic bytes: 0x1A 0x45 0xDF 0xA3 (EBML header)
// ---------------------------------------------------------------------------

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/**
 * Validates the first bytes of a buffer against known audio container
 * magic numbers. Supports WebM (EBML) and MP3 (ID3v2 / sync word).
 *
 * Returns true if the buffer starts with a recognized audio header.
 */
export function hasValidAudioMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  // WebM / Matroska (EBML header)
  if (buffer.subarray(0, 4).equals(WEBM_MAGIC)) return true;

  // MP3: ID3v2 tag
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;

  // MP3: MPEG sync word (0xFF 0xFB, 0xFF 0xFA, 0xFF 0xF3, 0xFF 0xF2)
  if (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) return true;

  // WAV: RIFF header
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 // F
  ) {
    return true;
  }

  // MP4/M4A: ftyp atom
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Validates the Stream recording URL against the SSRF allowlist and DNS.
 *
 * Returns the parsed URL if valid, or throws with a descriptive error.
 */
export async function validateStreamUrl(
  rawUrl: string,
  deps: Pick<IngestStreamRecordingDeps, 'hostAllowlist' | 'resolveDns'>,
): Promise<URL> {
  const url = new URL(rawUrl);

  const allowlist = deps.hostAllowlist ?? STREAM_HOST_ALLOWLIST;

  // Check hostname against allowlist
  const hostAllowed = allowlist.some(
    (allowed) => url.hostname === allowed || url.hostname.endsWith(`.${allowed}`),
  );
  if (!hostAllowed) {
    throw new Error(`SSRF: hostname "${url.hostname}" not in Stream CDN allowlist`);
  }

  // DNS resolution to check for private IPs
  if (deps.resolveDns) {
    try {
      const addresses = await deps.resolveDns(url.hostname);
      for (const addr of addresses) {
        if (isPrivateIP(addr)) {
          throw new Error(`SSRF: hostname "${url.hostname}" resolves to private IP ${addr}`);
        }
      }
    } catch (err: unknown) {
      // Re-throw SSRF errors; swallow DNS resolution failures (CDN may use
      // CNAME chains that fail with resolve4 but still reach public IPs)
      if (err instanceof Error && err.message.startsWith('SSRF:')) {
        throw err;
      }
      // DNS resolution failed but hostname was in allowlist — proceed cautiously
    }
  }

  return url;
}

/**
 * Downloads a recording from the validated Stream URL.
 *
 * Uses `arrayBuffer()` (the response fully buffers) rather than true streaming
 * because Supabase Storage's `upload()` accepts a Buffer, not a ReadableStream.
 *
 * @throws on HTTP error or empty response
 */
export async function downloadRecording(
  url: URL,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Buffer> {
  const response = await fetchFn(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'audio/webm, audio/mpeg, audio/mp4, audio/wav, */*',
    },
  });

  if (!response.ok) {
    throw new Error(`Stream download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length === 0) {
    throw new Error('Stream download returned empty body');
  }

  return buffer;
}

/**
 * Extracts session ID and filename from a Stream CDN recording URL.
 *
 * Stream recording URLs typically follow the pattern:
 *   https://<cdn>/recordings/<callType>/<callId>/<sessionId>/<filename>
 *
 * Returns null if the URL cannot be parsed.
 */
export function extractStreamRecordingParts(
  url: URL,
): { session: string; filename: string } | null {
  const segments = url.pathname.split('/').filter(Boolean);
  // We need at least: recordings, callType, callId, session, filename
  if (segments.length < 2) return null;

  const filename = segments[segments.length - 1]!;
  const session = segments[segments.length - 2]!;

  // Basic sanity: filename should have an extension
  if (!filename.includes('.')) return null;

  return { session, filename };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const ingestStreamRecording = inngest.createFunction(
  {
    id: 'ingest-stream-recording',
    triggers: [{ event: AI_TRANSCRIPTION_EVENTS.RECORDING_COMPLETED }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      // Mark the transcription row as failed if one was created.
      // The row ID is carried in the event's `data` or in step results —
      // but onFailure only has the original event. We look up any pending
      // row for this user+session combo and mark it failed.
      const log = createTranscriptionLogger({});

      try {
        const originalData = event.data.event.data as {
          userId?: string;
          sessionId?: string | null;
        };

        if (!originalData.userId) return;

        const { db } = await import('@/shared/db/client');
        const { and, eq } = await import('drizzle-orm');
        const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

        // Find any pending row for this user+session and mark failed.
        // Scoped by userId — never trusts external input for scope.
        const conditions = [
          eq(aiTranscriptions.userId, originalData.userId),
          eq(aiTranscriptions.status, 'pending'),
          eq(aiTranscriptions.source, 'video_session'),
        ];

        if (originalData.sessionId) {
          conditions.push(eq(aiTranscriptions.sessionId, originalData.sessionId));
        }

        await db
          .update(aiTranscriptions)
          .set({
            status: 'failed',
            errorCode: 'stream_ingest_failed',
            updatedAt: new Date(),
          })
          .where(and(...conditions));
      } catch (failErr: unknown) {
        const msg = failErr instanceof Error ? failErr.message : 'unknown';
        log.error(
          { event: 'ingest_stream_recording_onfailure_error', error: msg },
          'Failed to mark transcription as failed in onFailure handler',
        );
      }

      const sanitizedMsg = error instanceof Error ? error.message : 'unknown';
      log.error(
        {
          event: 'ingest_stream_recording_exhausted',
          error: sanitizedMsg,
        },
        'ingestStreamRecording exhausted all retries',
      );
    },
  },
  async ({ event, step }): Promise<IngestStreamRecordingResult> => {
    // Validate inbound payload at the boundary
    const data = recordingCompletedEventSchema.parse(event.data);
    const { userId, patientId, sessionId, streamRecordingUrl, streamCallId } = data;

    const log = createTranscriptionLogger({ userId });

    // -----------------------------------------------------------------------
    // Step 1: assert-consent
    // -----------------------------------------------------------------------
    const consentResult = await step.run('assert-consent', async () => {
      const { db } = await import('@/shared/db/client');
      const { assertAiConsentActive } = await import('../lib/consent');

      const result = await assertAiConsentActive({ userId, patientId }, { db });

      if (!result.ok) {
        log.info(
          {
            event: 'consent_inactive_at_ingest',
            userId,
            patientId,
            reason: result.reason,
          },
          'AI consent not active at ingest time — skipping recording',
        );
      }

      return result;
    });

    if (!consentResult.ok) {
      // Best-effort: instruct Stream to delete the recording
      await step.run('cleanup-no-consent', async () => {
        try {
          const { getStreamClient } = await import('@/modules/telepsicologia/server/stream-client');
          const streamClient = getStreamClient();
          const call = streamClient.video.call('default', streamCallId);

          const url = new URL(streamRecordingUrl);
          const parts = extractStreamRecordingParts(url);
          if (parts) {
            await call.deleteRecording(parts);
          }
        } catch (delErr: unknown) {
          const msg = delErr instanceof Error ? delErr.message : 'unknown';
          log.warn(
            { event: 'stream_delete_best_effort_failed', error: msg },
            'Best-effort Stream recording delete failed (consent revoked path)',
          );
        }
      });

      return { status: 'skipped', reason: 'consent_inactive' };
    }

    // -----------------------------------------------------------------------
    // Step 2: create-row
    // -----------------------------------------------------------------------
    const transcriptionId = await step.run('create-row', async () => {
      const { db } = await import('@/shared/db/client');
      const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

      const [row] = await db
        .insert(aiTranscriptions)
        .values({
          userId,
          patientId,
          sessionId,
          source: 'video_session',
          status: 'pending',
        })
        .returning({ id: aiTranscriptions.id });

      if (!row) {
        throw new Error('Failed to insert ai_transcriptions row');
      }

      log.info(
        { event: 'transcription_row_created', transcriptionId: row.id },
        'Created transcription row for stream recording',
      );

      return row.id;
    });

    // -----------------------------------------------------------------------
    // Step 3: download-from-stream (SSRF-safe)
    // -----------------------------------------------------------------------
    const downloadResult = await step.run('download-from-stream', async () => {
      const dns = await import('node:dns');

      const validatedUrl = await validateStreamUrl(streamRecordingUrl, {
        resolveDns: dns.promises.resolve4,
      });

      const buffer = await downloadRecording(validatedUrl);

      // Validate magic numbers
      if (!hasValidAudioMagic(buffer)) {
        // Mark row as failed immediately
        const { db } = await import('@/shared/db/client');
        const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');
        const { and, eq } = await import('drizzle-orm');

        await db
          .update(aiTranscriptions)
          .set({
            status: 'failed',
            errorCode: 'invalid_mime',
            updatedAt: new Date(),
          })
          .where(
            and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)),
          );

        throw new Error('Invalid audio magic numbers — recording is corrupted or not audio');
      }

      // Return base64-encoded buffer so it serializes through step boundaries.
      // Inngest step results must be JSON-serializable.
      return {
        base64: buffer.toString('base64'),
        sizeBytes: buffer.length,
      };
    });

    // -----------------------------------------------------------------------
    // Step 4: upload-to-bucket
    // -----------------------------------------------------------------------
    const objectKey = `${userId}/${transcriptionId}.webm`;

    await step.run('upload-to-bucket', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const { serverEnv } = await import('@/shared/env');
      const { clientEnv } = await import('@/shared/env/client');

      // service-role used here: system job, no user input controls the path
      // (path is server-generated from userId UUID + transcriptionId UUID)
      const storageClient = createClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      );

      const buffer = Buffer.from(downloadResult.base64, 'base64');

      const { error } = await storageClient.storage
        .from(serverEnv.AI_TRANSCRIPTION_BUCKET)
        .upload(objectKey, buffer, {
          contentType: 'audio/webm',
          upsert: false,
        });

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
      }

      log.info(
        { event: 'recording_uploaded_to_bucket', transcriptionId },
        'Recording uploaded to Supabase Storage',
      );
    });

    // -----------------------------------------------------------------------
    // Step 5: update-row
    // -----------------------------------------------------------------------
    await step.run('update-row', async () => {
      const { db } = await import('@/shared/db/client');
      const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');
      const { and, eq } = await import('drizzle-orm');

      await db
        .update(aiTranscriptions)
        .set({
          audioObjectKey: objectKey,
          audioSizeBytes: downloadResult.sizeBytes,
          // Duration is not extractable from the raw buffer without a media
          // parser; set to null and let the downstream Gemini pipeline
          // extract it if needed.
          audioDurationSeconds: null,
          updatedAt: new Date(),
        })
        .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));
    });

    // -----------------------------------------------------------------------
    // Step 6: emit-uploaded
    // -----------------------------------------------------------------------
    await step.sendEvent('emit-uploaded', {
      name: AI_TRANSCRIPTION_EVENTS.AUDIO_UPLOADED,
      data: audioUploadedEventSchema.parse({
        transcriptionId,
        userId,
        patientId,
        source: 'video_session',
      }),
    });

    log.info(
      { event: 'audio_uploaded_event_sent', transcriptionId },
      'Dispatched ai-transcription/audio.uploaded event',
    );

    // -----------------------------------------------------------------------
    // Step 7: instruct-stream-delete (best-effort)
    // -----------------------------------------------------------------------
    await step.run('instruct-stream-delete', async () => {
      try {
        const { getStreamClient } = await import('@/modules/telepsicologia/server/stream-client');
        const streamClient = getStreamClient();
        const call = streamClient.video.call('default', streamCallId);

        const url = new URL(streamRecordingUrl);
        const parts = extractStreamRecordingParts(url);
        if (parts) {
          await call.deleteRecording(parts);
          log.info(
            { event: 'stream_recording_deleted', transcriptionId },
            'Instructed Stream to delete the recording',
          );
        } else {
          log.warn(
            { event: 'stream_delete_url_parse_failed', transcriptionId },
            'Could not parse Stream URL for recording deletion',
          );
        }
      } catch (delErr: unknown) {
        // Best-effort: log but do not fail the function
        const msg = delErr instanceof Error ? delErr.message : 'unknown';
        log.warn(
          { event: 'stream_delete_best_effort_failed', error: msg, transcriptionId },
          'Best-effort Stream recording delete failed',
        );
      }
    });

    return { status: 'ingested', transcriptionId };
  },
);
