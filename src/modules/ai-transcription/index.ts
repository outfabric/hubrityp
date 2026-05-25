// Public API of the `ai-transcription` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/ai-transcription`,
// never from internal paths like `@/modules/ai-transcription/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports schemas, pure helpers, the domain logger, and
// (future) Server Action implementations. The `'use server'` directives will
// live on the route shells under `src/app/` which import from this barrel and
// re-export as bona fide Server Actions.

// ---- Branded types ----------------------------------------------------------
export { TranscriptionIdSchema, type TranscriptionId } from './lib/branded-types';

// ---- Zod schemas / enums ----------------------------------------------------
export {
  TranscriptionStatusSchema,
  type TranscriptionStatus,
  TranscriptionSourceSchema,
  type TranscriptionSource,
  TranscriptionTemplateSchema,
  type TranscriptionTemplate,
  RiskSensitivitySchema,
  type RiskSensitivity,
  GeneratedNoteSchema,
  type GeneratedNote,
  RiskAlertSchema,
  type RiskAlert,
} from './lib/schemas';

// ---- Consent template -------------------------------------------------------
export {
  AI_CONSENT_TEMPLATE_V1,
  type AiConsentTemplate,
  type ConsentTemplateSection,
} from './lib/consent-template';

// ---- Pure helpers -----------------------------------------------------------
export { pseudonymizeTranscript } from './lib/pseudonymize';

// ---- Logger -----------------------------------------------------------------
export { createTranscriptionLogger } from './lib/logger';

// ---- Server (placeholder — will be populated by downstream changes) ---------
export {} from './server';
