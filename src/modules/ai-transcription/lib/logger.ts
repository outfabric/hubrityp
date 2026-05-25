import 'server-only';

import { logger } from '@/shared/lib/logger';

import type { TranscriptionId } from './branded-types';

/**
 * LGPD-safe redaction paths specific to the ai-transcription domain.
 *
 * Every field that could contain clinical content, PII, audio references,
 * or AI prompts/responses is censored. The root logger already redacts
 * generic PII (email, CPF, phone); these paths cover domain-specific fields
 * that would otherwise leak into structured log output.
 */
const AI_TRANSCRIPTION_REDACT_PATHS = [
  'transcript',
  'generatedNote',
  'riskAlerts',
  'patientName',
  'patientFirstName',
  'patientFullName',
  'audioObjectKey',
  'audioUrl',
  'signedUrl',
  'rawGeminiResponse',
  'prompt',
] as const;

/**
 * Creates a Pino child logger scoped to a transcription operation.
 *
 * The child inherits the root logger's configuration (level, transport) and
 * adds domain-specific redaction so clinical content never reaches log sinks.
 */
export function createTranscriptionLogger(context: {
  transcriptionId?: TranscriptionId;
  userId?: string;
}) {
  return logger.child(
    { module: 'ai-transcription', ...context },
    {
      redact: {
        paths: [...AI_TRANSCRIPTION_REDACT_PATHS],
        censor: '[REDACTED]',
      },
    },
  );
}
