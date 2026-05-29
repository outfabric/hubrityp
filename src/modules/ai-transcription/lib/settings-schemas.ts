import { z } from 'zod';

import { RiskSensitivitySchema, TranscriptionTemplateSchema } from './schemas';

// ---------------------------------------------------------------------------
// Settings input / view schemas
// ---------------------------------------------------------------------------
//
// These schemas describe the per-psychologist AI-transcription preferences
// surfaced in `configuracoes` (RF-10.22). They mirror the
// `ai_transcription_settings` table columns (`enabled`, `default_template`,
// `risk_detection_sensitivity`, `keep_audio_hours`, `keep_transcription`).
//
// `TranscriptionTemplateSchema` and `RiskSensitivitySchema` are reused from the
// canonical domain enums in `./schemas` — do NOT redefine them here, so the
// form, the DB CHECK constraints, and the generation pipeline stay in lockstep.

/**
 * Input accepted by the `updateTranscriptionSettings` Server Action.
 *
 * `keepAudioHours` is intentionally narrower than the DB column (which permits
 * 24–168 via CHECK): the MVP form only ever emits `24` (design D2), so the
 * schema locks it to `z.literal(24)`. Anything else — including the otherwise
 * DB-valid `48`/`72`/`168` — is rejected at the boundary until the wider
 * retention UI ships. This is the single source of truth the action parses; do
 * not relax it without updating the form and the proposal.
 */
export const UpdateTranscriptionSettingsInputSchema = z.object({
  enabled: z.boolean(),
  defaultTemplate: TranscriptionTemplateSchema,
  riskDetectionSensitivity: RiskSensitivitySchema,
  // MVP-locked to 24h. See design D2.
  keepAudioHours: z.literal(24),
  keepTranscription: z.boolean(),
});
export type UpdateTranscriptionSettingsInput = z.infer<
  typeof UpdateTranscriptionSettingsInputSchema
>;

/**
 * Shape returned when reading the current settings for display in the form.
 *
 * Same shape as the input: the read is a faithful echo of what can be written,
 * which keeps the form's `defaultValues` and the submit payload symmetric. When
 * no row exists yet, the read layer is responsible for synthesizing the table
 * defaults (`enabled=false`, `defaultTemplate='livre'`, `sensitivity='medium'`,
 * `keepAudioHours=24`, `keepTranscription=false`).
 */
export const TranscriptionSettingsViewSchema = z.object({
  enabled: z.boolean(),
  defaultTemplate: TranscriptionTemplateSchema,
  riskDetectionSensitivity: RiskSensitivitySchema,
  keepAudioHours: z.literal(24),
  keepTranscription: z.boolean(),
});
export type TranscriptionSettingsView = z.infer<typeof TranscriptionSettingsViewSchema>;
