/**
 * Stub consumer for `ai-transcription/audio.uploaded` events.
 *
 * This function exists to prove the event wiring end-to-end. Downstream
 * changes (ai-transcription-gemini-processing) will replace the stub with
 * a real consumer that transitions the transcription row to `transcribing`
 * and kicks off the Gemini pipeline.
 *
 * The log line intentionally omits `patientId` and `source` — `patientId`
 * is PII-adjacent (enables cross-referencing), and `source` is not needed
 * for observability at this stage. Only structural IDs are logged.
 */

import { logger } from '@/shared/lib/logger';

import { inngest } from './client';
import { AI_TRANSCRIPTION_EVENTS, audioUploadedEventSchema } from './events';

// ---------------------------------------------------------------------------
// Core handler logic — extracted for testability
// ---------------------------------------------------------------------------

export interface AudioUploadedHandlerInput {
  transcriptionId: string;
  userId: string;
}

/**
 * Processes an audio-uploaded event. Logs receipt with structural IDs only.
 * No `patientId` or `source` in the log line — keeps it PII-free.
 */
export function handleAudioUploaded(input: AudioUploadedHandlerInput): void {
  logger.info(
    {
      event: 'ai-transcription/audio.uploaded.received',
      transcriptionId: input.transcriptionId,
      userId: input.userId,
    },
    'received',
  );
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const onAudioUploadedStub = inngest.createFunction(
  {
    id: 'on-audio-uploaded-stub',
    triggers: [{ event: AI_TRANSCRIPTION_EVENTS.AUDIO_UPLOADED }],
  },
  async ({ event, step }) => {
    await step.run('log-audio-uploaded', () => {
      // Validate inbound payload at the boundary
      const data = audioUploadedEventSchema.parse(event.data);

      handleAudioUploaded({
        transcriptionId: data.transcriptionId,
        userId: data.userId,
      });
    });
  },
);
