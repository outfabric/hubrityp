// Edge-runtime barrel for the `ai-transcription` module.
//
// Why a separate barrel from `index.ts`: the canonical barrel re-exports
// `createTranscriptionLogger` which transitively pulls `pino` (and its Node
// transports). Bundling those into the Next.js middleware (which runs on
// Edge) would crash with missing Node built-ins.
//
// This barrel re-exports ONLY symbols that are safe to evaluate inside an
// Edge worker:
//   - `TranscriptionIdSchema` / `TranscriptionId` — pure Zod, no Node deps.
//   - All enum schemas — pure Zod values, no DB or Node access.
//   - `GeneratedNoteSchema` / `RiskAlertSchema` — pure Zod object schemas.
//
// The middleware does not consume this module today, but the file MUST exist
// so future UI changes can extend `middleware.ts:classifyPath()` against an
// edge-safe boundary without pulling Node-only code.
//
// Consumers running on Edge MUST import from `@/modules/ai-transcription/edge`.
// Everything else continues to import from `@/modules/ai-transcription` and
// gets the full surface including the logger and pseudonymize helper.

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
