/**
 * Main AI transcription pipeline — Inngest function.
 *
 * Triggered by `ai-transcription/audio.uploaded` events emitted by either the
 * manual upload flow (`confirmAudioUpload`) or the video session flow
 * (`ingestStreamRecording`).
 *
 * Pipeline steps (13):
 *   1. assert-consent
 *   2. transition-to-transcribing
 *   3. download-audio
 *   4. send-to-gemini (Files API for >20MB, inline base64 otherwise)
 *   5. run-transcription
 *   6. pseudonymize
 *   7. transition-to-generating
 *   8. generate-note
 *   9. validate-note
 *  10. extract-risk-alerts
 *  11. delete-gemini-file (best-effort)
 *  12. persist-note
 *  13. broadcast-ready (best-effort)
 *
 * Design decisions:
 *   D1: Files API for >20MB, inline base64 for smaller files.
 *   D2: Two separate Gemini calls (transcription + note) so raw transcript
 *       never leaves the server un-pseudonymized.
 *   D3: responseJsonSchema + Zod double-defense for note structure.
 *   D10: temperature 0.1 for transcription, 0.2 for note generation.
 *   D11: Relaxed safety settings (BLOCK_ONLY_HIGH) for clinical content.
 *   D12: Cost is optional — fallback to NULL, never blocks the pipeline.
 *   D13: Each step is idempotent; re-execution is a no-op if already in target state.
 *
 * Service-role justification: this is a system Inngest job with no user session.
 * The Drizzle `db` client bypasses RLS (scoped by userId from the trusted event).
 * The Storage client uses service-role because the download path is
 * server-generated (no user input controls the object key).
 */

import { NonRetriableError } from 'inngest';

import { createTranscriptionLogger } from '../lib/logger';
import { computeCost } from '../lib/pricing';
import { pseudonymizeTranscript } from '../lib/pseudonymize';
import type { RiskSensitivity, TranscriptionTemplate } from '../lib/schemas';
import { GeneratedNoteSchema, type RiskAlert } from '../lib/schemas';
import {
  HarmBlockThreshold,
  HarmCategory,
  type GenerateContentResponse,
} from '../server/gemini-client';

import { inngest } from './client';
import { AI_TRANSCRIPTION_EVENTS, audioUploadedEventSchema } from './events';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 20 MB threshold for Files API (design decision D1).
 * Above this size, the audio is uploaded via `ai.files.upload` + URI reference.
 * Below, the audio is inlined as base64.
 */
const FILES_API_THRESHOLD_BYTES = 20 * 1024 * 1024;

/**
 * Relaxed safety settings for clinical content (design decision D11).
 * Therapy sessions routinely contain references to self-harm, violence, and
 * substance abuse. Blocking at MEDIUM would disrupt legitimate transcriptions.
 *
 * Imported from the gemini-client wrapper to avoid direct @google/genai imports.
 */
const RELAXED_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

// ---------------------------------------------------------------------------
// Types for the step results (JSON-serializable through Inngest boundaries)
// ---------------------------------------------------------------------------

interface DownloadAudioResult {
  base64: string;
  sizeBytes: number;
  contentType: string;
}

interface SendToGeminiResult {
  /** Non-null when the Files API was used (>20MB). */
  geminiFileName: string | null;
  geminiFileUri: string | null;
  /**
   * Always null — the inline base64 is NOT duplicated here to avoid storing
   * the audio twice in Inngest step state. Step 5 reads `downloadResult.base64`
   * directly for the inline path.
   */
  inlineBase64: null;
  mimeType: string;
}

/**
 * Step 5 result — the unredacted transcript of the therapy session.
 *
 * LGPD residual risk note: `rawTranscript` is ephemeral in Inngest step state
 * and is NEVER persisted to our database or logs. It is consumed only by step 6
 * (pseudonymize) and discarded after that step boundary. The
 * `@inngest/middleware-encryption` configured on the Inngest client encrypts
 * all step output client-side (AES-256 via LibSodium) before it reaches
 * Inngest Cloud, mitigating the data-residency risk for this field.
 */
interface TranscriptionResult {
  rawTranscript: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface PseudonymizedResult {
  pseudonymizedTranscript: string;
}

interface NoteResult {
  noteJson: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Helper: classify Gemini errors
// ---------------------------------------------------------------------------

/**
 * Classifies a Gemini API error into an error code for observability.
 *
 * Returns a tuple `[code, isRetriable]`:
 * - `gemini_429` (rate limit) → retriable
 * - `gemini_5xx` (server error) → retriable
 * - `gemini_safety_block` → non-retriable
 * - `gemini_unknown` → retriable (benefit of the doubt)
 */
function classifyGeminiError(err: unknown): [string, boolean] {
  if (!(err instanceof Error)) return ['gemini_unknown', true];

  const msg = err.message.toLowerCase();

  // Rate limit (429)
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
    return ['gemini_429', true];
  }

  // Server errors (5xx)
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('internal')
  ) {
    return ['gemini_5xx', true];
  }

  // Safety block
  if (msg.includes('safety') || msg.includes('blocked')) {
    return ['gemini_safety_block', false];
  }

  return ['gemini_unknown', true];
}

/**
 * Checks the response's finish reason for a safety block.
 * The Gemini SDK does not always throw on safety blocks; sometimes the
 * response has finishReason=SAFETY with empty text.
 */
function isSafetyBlocked(response: GenerateContentResponse): boolean {
  const candidate = response.candidates?.[0];
  if (!candidate) return true;

  // Compare as string to avoid ESLint no-unsafe-enum-comparison — the SDK
  // defines FinishReason as an enum but the wire value is a plain string.
  return String(candidate.finishReason) === 'SAFETY';
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const processAudioTranscription = inngest.createFunction(
  {
    id: 'process-audio-transcription',
    triggers: [{ event: AI_TRANSCRIPTION_EVENTS.AUDIO_UPLOADED }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const log = createTranscriptionLogger({});

      try {
        const parsed = audioUploadedEventSchema.safeParse(event.data.event.data);
        if (!parsed.success) {
          log.warn(
            { event: 'onfailure_parse_error' },
            'onFailure: could not parse original event data — skipping markAsFailed',
          );
          return;
        }

        const { transcriptionId, userId } = parsed.data;

        const { db } = await import('@/shared/db/client');
        const { and, eq } = await import('drizzle-orm');
        const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

        await db
          .update(aiTranscriptions)
          .set({
            status: 'failed',
            errorCode: 'pipeline_exhausted',
            updatedAt: new Date(),
          })
          .where(
            and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)),
          );
      } catch (failErr: unknown) {
        const msg = failErr instanceof Error ? failErr.message : 'unknown';
        log.error(
          { event: 'process_audio_onfailure_error', error: msg },
          'Failed to mark transcription as failed in onFailure handler',
        );
      }

      const sanitizedMsg = error instanceof Error ? error.message : 'unknown';
      log.error(
        { event: 'process_audio_transcription_exhausted', error: sanitizedMsg },
        'processAudioTranscription exhausted all retries',
      );
    },
  },
  async ({ event, step }) => {
    // Validate inbound payload at the boundary
    const data = audioUploadedEventSchema.parse(event.data);
    const { transcriptionId, userId, patientId } = data;

    const log = createTranscriptionLogger({
      transcriptionId,
      userId,
    });

    // -------------------------------------------------------------------
    // Step 1: assert-consent
    // -------------------------------------------------------------------
    await step.run('assert-consent', async () => {
      const { db } = await import('@/shared/db/client');
      const { assertAiConsentActive } = await import('../lib/consent');

      const result = await assertAiConsentActive({ userId, patientId }, { db });

      if (!result.ok) {
        log.info(
          { event: 'consent_inactive_at_pipeline', reason: result.reason },
          'AI consent not active — aborting pipeline without DB writes',
        );
        throw new NonRetriableError('CONSENT_INACTIVE');
      }

      log.info({ event: 'consent_verified' }, 'AI consent verified — proceeding with pipeline');
    });

    // -------------------------------------------------------------------
    // Step 2: transition-to-transcribing (idempotent)
    // -------------------------------------------------------------------
    await step.run('transition-to-transcribing', async () => {
      const { db } = await import('@/shared/db/client');
      const { and, eq, inArray } = await import('drizzle-orm');
      const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

      await db
        .update(aiTranscriptions)
        .set({ status: 'transcribing', updatedAt: new Date() })
        .where(
          and(
            eq(aiTranscriptions.id, transcriptionId),
            eq(aiTranscriptions.userId, userId),
            inArray(aiTranscriptions.status, ['pending', 'transcribing']),
          ),
        );

      log.info({ event: 'status_transition', to: 'transcribing' }, 'Transitioned to transcribing');
    });

    // -------------------------------------------------------------------
    // Step 3: download-audio from Supabase Storage
    // -------------------------------------------------------------------
    const downloadResult: DownloadAudioResult = await step.run('download-audio', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const { serverEnv } = await import('@/shared/env');
      const { clientEnv } = await import('@/shared/env/client');
      const { db } = await import('@/shared/db/client');
      const { eq, and } = await import('drizzle-orm');
      const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

      // Look up the audio object key and size from the transcription row
      const [row] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioSizeBytes: aiTranscriptions.audioSizeBytes,
        })
        .from(aiTranscriptions)
        .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));

      if (!row?.audioObjectKey) {
        throw new NonRetriableError('AUDIO_OBJECT_KEY_MISSING');
      }

      // Pre-download size guard: prevent OOM by rejecting files that exceed
      // the configured max before loading them into memory as base64.
      const maxBytes = serverEnv.AI_TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;
      if (row.audioSizeBytes && row.audioSizeBytes > maxBytes) {
        throw new NonRetriableError('AUDIO_EXCEEDS_PIPELINE_LIMIT');
      }

      // SSRF safety: the URL used for download is server-generated from
      // `audio_object_key`, never client input. The key is set by the server
      // during `confirmAudioUpload` (manual flow) or `ingestStreamRecording`
      // (video flow) and read from the DB row scoped by userId. The Supabase
      // Storage SDK constructs the HTTP request internally — no raw URL is
      // exposed to or controlled by the client.

      // Service-role: system job, path is server-generated UUID-based key
      const supabase = createClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      );

      const { data: blob, error } = await supabase.storage
        .from(serverEnv.AI_TRANSCRIPTION_BUCKET)
        .download(row.audioObjectKey);

      if (error || !blob) {
        throw new Error(`Storage download failed: ${error?.message ?? 'empty response'}`);
      }

      const buffer = Buffer.from(await blob.arrayBuffer());

      log.info(
        { event: 'audio_downloaded', sizeBytes: buffer.length },
        'Audio downloaded from Storage',
      );

      // Determine content type from the object key extension
      const ext = row.audioObjectKey.split('.').pop()?.toLowerCase();
      const contentTypeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        wav: 'audio/wav',
        webm: 'audio/webm',
      };
      const contentType = contentTypeMap[ext ?? ''] ?? 'audio/webm';

      return {
        base64: buffer.toString('base64'),
        sizeBytes: buffer.length,
        contentType,
      };
    });

    // -------------------------------------------------------------------
    // Step 4: send-to-gemini (Files API for >20MB, inline for smaller)
    // -------------------------------------------------------------------
    const geminiFileResult: SendToGeminiResult = await step.run('send-to-gemini', async () => {
      if (downloadResult.sizeBytes > FILES_API_THRESHOLD_BYTES) {
        // Files API path (D1)
        const { getGeminiClient } = await import('../server/gemini-client');
        const ai = getGeminiClient();

        const audioBuffer = Buffer.from(downloadResult.base64, 'base64');
        const blob = new Blob([audioBuffer], { type: downloadResult.contentType });

        const file = await ai.files.upload({
          file: blob,
          config: {
            mimeType: downloadResult.contentType,
          },
        });

        if (!file.name || !file.uri) {
          throw new Error('Files API upload returned no name/uri');
        }

        log.info(
          { event: 'gemini_file_uploaded', hasName: true },
          'Audio uploaded to Gemini Files API (>20MB)',
        );

        return {
          geminiFileName: file.name,
          geminiFileUri: file.uri,
          inlineBase64: null,
          mimeType: downloadResult.contentType,
        };
      }

      // Inline base64 path (<=20MB) — do NOT duplicate base64 into this step's
      // return value; step 5 reads `downloadResult.base64` directly instead.
      // This halves Inngest step-state storage for the common case.
      log.info(
        { event: 'gemini_inline_audio', sizeBytes: downloadResult.sizeBytes },
        'Audio will be sent inline (<=20MB)',
      );

      return {
        geminiFileName: null,
        geminiFileUri: null,
        inlineBase64: null,
        mimeType: downloadResult.contentType,
      };
    });

    // -------------------------------------------------------------------
    // Step 5: run-transcription
    // -------------------------------------------------------------------
    const transcriptionResult: TranscriptionResult = await step.run(
      'run-transcription',
      async () => {
        const { getGeminiClient, createPartFromUri } = await import('../server/gemini-client');
        const { serverEnv } = await import('@/shared/env');
        const { TRANSCRIPTION_SYSTEM_INSTRUCTION } = await import('../server/prompts');

        const ai = getGeminiClient();
        const model = serverEnv.GEMINI_MODEL_TRANSCRIPTION;

        // Build contents: either Files API URI or inline base64.
        // For the inline path, read base64 from step 3's downloadResult
        // (not from geminiFileResult) to avoid storing the audio twice in
        // Inngest step state.
        const audioPart =
          geminiFileResult.geminiFileUri !== null
            ? createPartFromUri(geminiFileResult.geminiFileUri, geminiFileResult.mimeType)
            : {
                inlineData: {
                  data: downloadResult.base64,
                  mimeType: geminiFileResult.mimeType,
                },
              };

        let response: GenerateContentResponse;
        try {
          response = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [audioPart] }],
            config: {
              systemInstruction: TRANSCRIPTION_SYSTEM_INSTRUCTION,
              responseMimeType: 'text/plain',
              temperature: 0.1,
              safetySettings: RELAXED_SAFETY_SETTINGS,
            },
          });
        } catch (err: unknown) {
          const [code, isRetriable] = classifyGeminiError(err);
          const msg = err instanceof Error ? err.message : 'unknown';
          log.error(
            { event: 'transcription_gemini_error', errorCode: code, error: msg },
            'Gemini transcription call failed',
          );
          if (!isRetriable) {
            throw new NonRetriableError(`GEMINI_ERROR:${code}`);
          }
          throw err;
        }

        if (isSafetyBlocked(response)) {
          log.error(
            { event: 'transcription_safety_blocked' },
            'Gemini transcription blocked by safety filters',
          );
          throw new NonRetriableError('GEMINI_SAFETY_BLOCK');
        }

        const rawTranscript = response.text;
        if (!rawTranscript) {
          throw new Error('Gemini transcription returned empty text');
        }

        const usage = response.usageMetadata;
        return {
          rawTranscript,
          inputTokens: Number(usage?.promptTokenCount ?? 0),
          outputTokens: Number(usage?.candidatesTokenCount ?? 0),
          model,
        };
      },
    );

    // -------------------------------------------------------------------
    // Step 6: pseudonymize (load patient name, replace in transcript)
    // -------------------------------------------------------------------
    const pseudonymized: PseudonymizedResult = await step.run('pseudonymize', async () => {
      const { db } = await import('@/shared/db/client');
      const { eq, and } = await import('drizzle-orm');
      const { patients } = await import('@/shared/db/schema/patients/tables');

      const [patient] = await db
        .select({ fullName: patients.fullName })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

      if (!patient) {
        throw new NonRetriableError('PATIENT_NOT_FOUND');
      }

      const firstName = patient.fullName.split(/\s+/)[0] ?? patient.fullName;

      const pseudonymizedTranscript = pseudonymizeTranscript({
        patientFirstName: firstName,
        patientFullName: patient.fullName,
        transcript: transcriptionResult.rawTranscript,
      });

      log.info({ event: 'transcript_pseudonymized' }, 'Transcript pseudonymized successfully');

      return { pseudonymizedTranscript };
    });

    // -------------------------------------------------------------------
    // Step 7: transition-to-generating (idempotent)
    // -------------------------------------------------------------------
    await step.run('transition-to-generating', async () => {
      const { db } = await import('@/shared/db/client');
      const { and, eq, inArray } = await import('drizzle-orm');
      const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

      await db
        .update(aiTranscriptions)
        .set({ status: 'generating', updatedAt: new Date() })
        .where(
          and(
            eq(aiTranscriptions.id, transcriptionId),
            eq(aiTranscriptions.userId, userId),
            inArray(aiTranscriptions.status, ['transcribing', 'generating']),
          ),
        );

      log.info({ event: 'status_transition', to: 'generating' }, 'Transitioned to generating');
    });

    // -------------------------------------------------------------------
    // Step 8: generate-note
    // -------------------------------------------------------------------
    const noteResult: NoteResult = await step.run('generate-note', async () => {
      const { getGeminiClient } = await import('../server/gemini-client');
      const { serverEnv } = await import('@/shared/env');
      const { getNotePromptModule } = await import('../server/prompts');
      const { GeminiNoteJsonSchema } = await import('../server/json-schemas/gemini-note');
      const { db } = await import('@/shared/db/client');
      const { eq } = await import('drizzle-orm');
      const { aiTranscriptionSettings } =
        await import('@/shared/db/schema/ai-transcription/tables');

      const ai = getGeminiClient();
      const model = serverEnv.GEMINI_MODEL_NOTE;

      // Load user settings for template + sensitivity
      const [settings] = await db
        .select({
          defaultTemplate: aiTranscriptionSettings.defaultTemplate,
          riskDetectionSensitivity: aiTranscriptionSettings.riskDetectionSensitivity,
        })
        .from(aiTranscriptionSettings)
        .where(eq(aiTranscriptionSettings.userId, userId));

      // Fallback to defaults if no settings row exists
      const template = (settings?.defaultTemplate ?? 'livre') as TranscriptionTemplate;
      const sensitivity = (settings?.riskDetectionSensitivity ?? 'medium') as RiskSensitivity;

      const promptModule = getNotePromptModule(template);
      const systemInstruction = promptModule.buildSystemInstruction(sensitivity);

      let response: GenerateContentResponse;
      try {
        response = await ai.models.generateContent({
          model,
          contents: pseudonymized.pseudonymizedTranscript,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseJsonSchema: GeminiNoteJsonSchema,
            temperature: 0.2,
            safetySettings: RELAXED_SAFETY_SETTINGS,
          },
        });
      } catch (err: unknown) {
        const [code, isRetriable] = classifyGeminiError(err);
        const msg = err instanceof Error ? err.message : 'unknown';
        log.error(
          { event: 'note_gemini_error', errorCode: code, error: msg },
          'Gemini note generation call failed',
        );
        if (!isRetriable) {
          throw new NonRetriableError(`GEMINI_ERROR:${code}`);
        }
        throw err;
      }

      if (isSafetyBlocked(response)) {
        log.error(
          { event: 'note_safety_blocked' },
          'Gemini note generation blocked by safety filters',
        );
        throw new NonRetriableError('GEMINI_SAFETY_BLOCK');
      }

      const noteText = response.text;
      if (!noteText) {
        throw new Error('Gemini note generation returned empty text');
      }

      const usage = response.usageMetadata;
      return {
        noteJson: noteText,
        inputTokens: Number(usage?.promptTokenCount ?? 0),
        outputTokens: Number(usage?.candidatesTokenCount ?? 0),
        model,
      };
    });

    // -------------------------------------------------------------------
    // Step 9: validate-note (Zod double-defense — D3)
    // -------------------------------------------------------------------
    const validatedNote = await step.run('validate-note', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(noteResult.noteJson);
      } catch {
        throw new Error('invalid_response_schema: Gemini response is not valid JSON');
      }

      const result = GeneratedNoteSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        throw new Error(`invalid_response_schema: ${issues.join('; ')}`);
      }

      return result.data;
    });

    // -------------------------------------------------------------------
    // Step 10: extract-risk-alerts
    // -------------------------------------------------------------------
    const riskAlerts: RiskAlert[] = await step.run('extract-risk-alerts', () => {
      const alerts: RiskAlert[] = [];

      for (const keyword of validatedNote.palavrasRisco) {
        // Map keywords to structured alerts with a heuristic classification.
        // The exact classification is secondary — the psychologist reviews all.
        const lower = keyword.toLowerCase();

        let kind: RiskAlert['kind'] = 'third_party_risk';
        if (
          lower.includes('suicid') ||
          lower.includes('matar') ||
          lower.includes('morrer') ||
          lower.includes('morte')
        ) {
          kind = 'suicidal';
        } else if (
          lower.includes('autolesão') ||
          lower.includes('autolesao') ||
          lower.includes('cortar') ||
          lower.includes('corte') ||
          lower.includes('machucar')
        ) {
          kind = 'self_harm';
        } else if (
          lower.includes('violência') ||
          lower.includes('agress') ||
          lower.includes('bater')
        ) {
          kind = 'domestic_violence';
        } else if (
          lower.includes('droga') ||
          lower.includes('álcool') ||
          lower.includes('substância') ||
          lower.includes('alcool')
        ) {
          kind = 'substance_abuse';
        }

        alerts.push({
          kind,
          excerpt: keyword.slice(0, 500),
          confidence: 'medium',
        });
      }

      log.info(
        { event: 'risk_alerts_extracted', count: alerts.length },
        'Risk alerts extracted from generated note',
      );

      return alerts;
    });

    // -------------------------------------------------------------------
    // Step 11: delete-gemini-file (best-effort)
    // -------------------------------------------------------------------
    await step.run('delete-gemini-file', async () => {
      if (!geminiFileResult.geminiFileName) {
        // Inline path — no file to delete.
        return;
      }

      try {
        const { getGeminiClient } = await import('../server/gemini-client');
        const ai = getGeminiClient();

        // SSRF safety: `geminiFileName` is the server-owned file name returned
        // by `ai.files.upload()` in step 4 (send-to-gemini), never user input.
        // The Gemini SDK `files.delete` method uses the SDK's internal HTTP
        // client to call the Files API — no raw URL is constructed from external
        // input.
        await ai.files.delete({ name: geminiFileResult.geminiFileName });

        log.info({ event: 'gemini_file_deleted' }, 'Gemini file deleted successfully');
      } catch (err: unknown) {
        // Best-effort: log and swallow
        const msg = err instanceof Error ? err.message : 'unknown';
        log.warn(
          { event: 'gemini_file_delete_failed', error: msg },
          'Best-effort Gemini file deletion failed — swallowing',
        );
      }
    });

    // -------------------------------------------------------------------
    // Step 12: persist-note (idempotent — only updates if status=generating)
    // -------------------------------------------------------------------
    await step.run('persist-note', async () => {
      const { db } = await import('@/shared/db/client');
      const { and, eq, inArray } = await import('drizzle-orm');
      const { aiTranscriptions, aiTranscriptionSettings } =
        await import('@/shared/db/schema/ai-transcription/tables');
      const { getNotePromptModule, TRANSCRIPTION_PROMPT_VERSION } =
        await import('../server/prompts');

      // Re-load settings for template metadata
      const [settings] = await db
        .select({
          defaultTemplate: aiTranscriptionSettings.defaultTemplate,
        })
        .from(aiTranscriptionSettings)
        .where(eq(aiTranscriptionSettings.userId, userId));

      const template = (settings?.defaultTemplate ?? 'livre') as TranscriptionTemplate;
      const promptModule = getNotePromptModule(template);

      // Compute costs (D12: graceful degradation — null if model unknown)
      const transcriptionCost = computeCost({
        model: transcriptionResult.model,
        inputTokens: transcriptionResult.inputTokens,
        outputTokens: transcriptionResult.outputTokens,
      });
      const llmCost = computeCost({
        model: noteResult.model,
        inputTokens: noteResult.inputTokens,
        outputTokens: noteResult.outputTokens,
      });

      const templateUsed = `${template}:v${promptModule.PROMPT_VERSION}+t:v${TRANSCRIPTION_PROMPT_VERSION}`;

      await db
        .update(aiTranscriptions)
        .set({
          generatedNote: validatedNote,
          riskAlerts: riskAlerts,
          templateUsed,
          transcriptionCostUsd: transcriptionCost?.toFixed(4) ?? null,
          llmCostUsd: llmCost?.toFixed(4) ?? null,
          status: 'ready',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiTranscriptions.id, transcriptionId),
            eq(aiTranscriptions.userId, userId),
            inArray(aiTranscriptions.status, ['generating', 'ready']),
          ),
        );

      log.info(
        { event: 'note_persisted', template: templateUsed },
        'Generated note persisted and status set to ready',
      );
    });

    // -------------------------------------------------------------------
    // Step 13: broadcast-ready (best-effort)
    // -------------------------------------------------------------------
    await step.run('broadcast-ready', async () => {
      const { broadcastAiReady } = await import('../server/realtime/broadcast');
      const { serverEnv } = await import('@/shared/env');

      await broadcastAiReady(
        { userId, transcriptionId },
        { serviceRoleKey: serverEnv.SUPABASE_SERVICE_ROLE_KEY },
      );
    });

    log.info({ event: 'pipeline_complete' }, 'AI transcription pipeline completed successfully');

    return { status: 'completed', transcriptionId };
  },
);
