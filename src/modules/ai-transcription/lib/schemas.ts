import { z } from 'zod';

// ---------------------------------------------------------------------------
// Canonical Zod enums for the ai-transcription domain
// ---------------------------------------------------------------------------

export const TranscriptionStatusSchema = z.enum([
  'pending',
  'transcribing',
  'generating',
  'ready',
  'reviewed',
  'failed',
]);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

export const TranscriptionSourceSchema = z.enum(['video_session', 'manual_upload']);
export type TranscriptionSource = z.infer<typeof TranscriptionSourceSchema>;

export const TranscriptionTemplateSchema = z.enum([
  'tcc',
  'psicanalise',
  'sistemica',
  'aba',
  'livre',
]);
export type TranscriptionTemplate = z.infer<typeof TranscriptionTemplateSchema>;

export const RiskSensitivitySchema = z.enum(['low', 'medium', 'high']);
export type RiskSensitivity = z.infer<typeof RiskSensitivitySchema>;

// ---------------------------------------------------------------------------
// Consent template snapshot (stored in JSONB at generation time)
// ---------------------------------------------------------------------------

/** A single section of the consent template (heading + body). */
export const ConsentTemplateSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});

/**
 * Full shape of the versioned consent template, used to validate the
 * `template_snapshot` JSONB column on read. This ensures that even if
 * someone tampers with the stored JSON, the renderer only sees a known shape.
 */
export const AiConsentTemplateSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  sections: z.array(ConsentTemplateSectionSchema).min(1),
});
export type AiConsentTemplateSnapshot = z.infer<typeof AiConsentTemplateSchema>;

// ---------------------------------------------------------------------------
// Structured payloads
// ---------------------------------------------------------------------------

/**
 * Schema for the AI-generated clinical note.
 *
 * `schemaVersion` is pinned to `1` so downstream consumers can discriminate
 * between versions when the shape evolves (additive changes get a new literal,
 * and a discriminated union handles migration).
 */
export const GeneratedNoteSchema = z.object({
  schemaVersion: z.literal(1),
  humorInicial: z.string().nullable(),
  humorFinal: z.string().nullable(),
  pauta: z.array(z.string()),
  conteudoTrabalhado: z.array(z.string()),
  tarefaCasa: z.array(z.string()),
  palavrasRisco: z.array(z.string()),
  observacoesExtras: z.string().nullable(),
});
export type GeneratedNote = z.infer<typeof GeneratedNoteSchema>;

/**
 * Schema for a single risk alert detected in a transcript.
 *
 * `kind` is a closed enum so unknown risk types are caught at parse time.
 * `excerpt` is capped at 500 characters to prevent accidental storage of
 * large transcript fragments.
 */
export const RiskAlertSchema = z.object({
  kind: z.enum([
    'suicidal',
    'self_harm',
    'domestic_violence',
    'third_party_risk',
    'substance_abuse',
  ]),
  excerpt: z.string().max(500),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type RiskAlert = z.infer<typeof RiskAlertSchema>;
