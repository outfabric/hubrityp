import 'server-only';

/**
 * Prompt version for the transcription system instruction.
 *
 * Bump this number whenever the instruction text changes so that
 * `template_used` values in the database stay auditable.
 */
export const PROMPT_VERSION = 1;

/**
 * System instruction sent to Gemini for the audio-to-text transcription step.
 *
 * Design decision D2: the transcription call is intentionally minimal —
 * "transcribe, preserve hesitations, do not interpret". The heavier
 * template-specific work happens in a second call that receives the
 * already-pseudonymized transcript.
 */
export const TRANSCRIPTION_SYSTEM_INSTRUCTION =
  'Transcreva o áudio em português brasileiro, preservando hesitações e silêncios entre colchetes. Não interprete.';
