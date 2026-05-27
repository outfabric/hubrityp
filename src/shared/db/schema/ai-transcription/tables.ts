import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// `ai_transcription_settings` stores per-psychologist preferences for the AI
// transcription feature. 1:1 with `auth.users` via UNIQUE on `user_id`. The
// table governs defaults for template selection, audio retention, and risk
// detection sensitivity.
//
// `keep_audio_hours` is CHECK-constrained to [24, 168] (1 day to 1 week).
// `default_template` and `risk_detection_sensitivity` are text enums validated
// via CHECK constraints in the migration SQL.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const aiTranscriptionSettings = pgTable(
  'ai_transcription_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    // UNIQUE constraint enforces 1:1 with the psychologist.
    userId: uuid('user_id').notNull(),

    enabled: boolean('enabled').notNull().default(false),

    // Therapeutic approach template: CHECK in migration constrains to the
    // allowed set ('tcc','psicanalise','sistemica','aba','livre').
    defaultTemplate: text('default_template').notNull().default('livre'),

    // Hours before audio is auto-discarded. CHECK: 24 <= value <= 168.
    keepAudioHours: integer('keep_audio_hours').notNull().default(24),

    // Whether to retain the transcription text after audio discard.
    keepTranscription: boolean('keep_transcription').notNull().default(false),

    // Risk detection sensitivity level: CHECK in migration constrains to
    // ('low','medium','high').
    riskDetectionSensitivity: text('risk_detection_sensitivity').notNull().default('medium'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('ai_transcription_settings_user_id_unique').on(table.userId),

    check(
      'ai_transcription_settings_template_check',
      sql`${table.defaultTemplate} IN ('tcc', 'psicanalise', 'sistemica', 'aba', 'livre')`,
    ),
    check(
      'ai_transcription_settings_keep_audio_hours_check',
      sql`${table.keepAudioHours} >= 24 AND ${table.keepAudioHours} <= 168`,
    ),
    check(
      'ai_transcription_settings_sensitivity_check',
      sql`${table.riskDetectionSensitivity} IN ('low', 'medium', 'high')`,
    ),
  ],
);

export type AiTranscriptionSettings = typeof aiTranscriptionSettings.$inferSelect;
export type NewAiTranscriptionSettings = typeof aiTranscriptionSettings.$inferInsert;

// `ai_transcriptions` stores individual transcription jobs. Each row tracks a
// single audio-to-note pipeline execution: upload/capture -> transcribe ->
// generate note -> review. The status column models the full lifecycle as a
// state machine with CHECK constraint.
//
// FKs: `user_id` NOT NULL (owner), `patient_id` NOT NULL, `session_id`
// nullable (ON DELETE SET NULL), `evolution_id` nullable (ON DELETE SET NULL).
//
// `generated_note` is a JSONB payload that includes a `schemaVersion` field
// managed at the application level (not a DB column).
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const aiTranscriptions = pgTable(
  'ai_transcriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // FK to `sessions(id)` ON DELETE SET NULL. Emitted manually in migration.
    sessionId: uuid('session_id'),

    // FK to `evolutions(id)` ON DELETE SET NULL. Emitted manually in migration.
    evolutionId: uuid('evolution_id'),

    // Source of the audio: captured from a video session or manually uploaded.
    // CHECK in migration: ('video_session', 'manual_upload').
    source: text('source').notNull(),

    // --- Audio metadata (nullable — populated after upload) ---
    audioObjectKey: text('audio_object_key'),
    audioSizeBytes: bigint('audio_size_bytes', { mode: 'number' }),
    audioDurationSeconds: integer('audio_duration_seconds'),
    audioDiscardedAt: timestamp('audio_discarded_at', { withTimezone: true }),

    // --- Generation output ---
    templateUsed: text('template_used'),
    generatedNote: jsonb('generated_note'),
    riskAlerts: jsonb('risk_alerts'),

    // --- Status lifecycle ---
    // CHECK: ('pending','transcribing','generating','ready','reviewed','failed','cancelled')
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    retryCount: integer('retry_count').notNull().default(0),

    // --- Cost tracking (approximate USD from Gemini API usage metadata) ---
    transcriptionCostUsd: numeric('transcription_cost_usd', { precision: 10, scale: 4 }),
    llmCostUsd: numeric('llm_cost_usd', { precision: 10, scale: 4 }),

    // --- Review/save tracking ---
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    savedToProntuario: boolean('saved_to_prontuario').notNull().default(false),
    userEditsCount: integer('user_edits_count').notNull().default(0),

    // --- Timestamps ---
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // Most common query: "all transcriptions for this user filtered by status".
    index('idx_ai_transcriptions_user_status').on(table.userId, table.status),

    // Timeline query: "all transcriptions for this user, newest first".
    index('idx_ai_transcriptions_user_created').on(table.userId, table.createdAt),

    // Discard cron: find rows with audio still present and not yet discarded.
    index('idx_ai_transcriptions_audio_to_discard')
      .on(table.createdAt)
      .where(sql`audio_object_key IS NOT NULL AND audio_discarded_at IS NULL`),

    check(
      'ai_transcriptions_source_check',
      sql`${table.source} IN ('video_session', 'manual_upload')`,
    ),
    check(
      'ai_transcriptions_status_check',
      sql`${table.status} IN ('pending', 'transcribing', 'generating', 'ready', 'reviewed', 'failed', 'cancelled')`,
    ),
  ],
);

export type AiTranscription = typeof aiTranscriptions.$inferSelect;
export type NewAiTranscription = typeof aiTranscriptions.$inferInsert;
