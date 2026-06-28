import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `video_rooms` represents a telepsychology video call room linked to a
// clinical session. Each room holds the Stream.io call ID plus pre-generated
// tokens and JWTs for patient/partner access (no auth account needed).
// The `patient_token` is a 64-char hex lookup token used in public URLs;
// `patient_jwt` is the Stream JWT granting call access. Same for partner.
//
// Status lifecycle: pending -> active -> ended (or expired via cron).
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const videoRooms = pgTable(
  'video_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `sessions`. Cross-schema reference emitted manually in migration.
    // UNIQUE constraint enforces 1:1 relationship (one room per session).
    sessionId: uuid('session_id').notNull(),

    // Stream.io call identifier for the video room. Nullable: a room is
    // first *reserved* at schedule time (status='pending') without a Stream
    // call, then *activated* (startAt − 1h, via Inngest) which populates this.
    streamCallId: varchar('stream_call_id', { length: 255 }),

    // Patient access: 64-char hex token for URL lookup + Stream JWT for call.
    // `patientJwt` is nullable for the same reservation/activation reason as
    // `streamCallId` — it is minted only when the room is activated.
    patientToken: varchar('patient_token', { length: 64 }).notNull(),
    patientJwt: text('patient_jwt'),

    // Partner access (optional): same pattern as patient.
    partnerToken: varchar('partner_token', { length: 64 }),
    partnerJwt: text('partner_jwt'),

    // Time window during which the room is accessible.
    availableFrom: timestamp('available_from', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    // Recording controls — consent must be signed before recording starts.
    recordingEnabled: boolean('recording_enabled').default(false),
    recordingConsentSigned: boolean('recording_consent_signed').default(false),

    // Room lifecycle status. CHECK constraint enforces valid values.
    status: text('status').notNull().default('pending'),

    // First-arrival marker for the patient in the waiting room. IMMUTABLE:
    // set exactly once, on the first waiting poll, and never advanced after.
    // Why: it is the audit/wait-time anchor ("patient was waiting since X"),
    // a fact that must not move when the liveness heartbeat below refreshes.
    patientWaitingAt: timestamp('patient_waiting_at', { withTimezone: true, mode: 'date' }),

    // Liveness heartbeat for the patient in the waiting room. MUTABLE:
    // advanced on every waiting poll, and reset to NULL on departure.
    // Why: it answers "is the patient still here right now?" — it is watched
    // by the broadcast trigger and seeds the psychologist's presence badge.
    // Distinct from `patientWaitingAt` because "first arrived" (audit) and
    // "still here" (liveness) are different facts with different mutability.
    patientLastSeenAt: timestamp('patient_last_seen_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // 1:1 with sessions — enforced at DB level.
    uniqueIndex('video_rooms_session_id_unique_idx').on(table.sessionId),

    // Common query: "rooms for this user filtered by status" (e.g. active rooms).
    index('video_rooms_user_id_status_idx').on(table.userId, table.status),

    // Cron job: expire rooms past their window.
    index('video_rooms_expires_at_idx').on(table.expiresAt),

    // Patient token lookup: public Route Handlers query by patient_token.
    // Unique because each room gets a fresh randomBytes(32) — enforces
    // uniqueness at DB level as belt-and-suspenders.
    uniqueIndex('video_rooms_patient_token_idx').on(table.patientToken),

    // Partner token lookup: public Route Handlers query by partner_token.
    // Plain index (not unique) because the column is nullable.
    index('video_rooms_partner_token_idx').on(table.partnerToken),

    // Status CHECK — enforces the valid room lifecycle states at DB level.
    check(
      'video_rooms_status_check',
      sql`${table.status} IN ('pending', 'active', 'ended', 'expired')`,
    ),
  ],
);

export type VideoRoom = typeof videoRooms.$inferSelect;
export type NewVideoRoom = typeof videoRooms.$inferInsert;

// `video_session_logs` is an append-only audit log for telepsychology events.
// Each entry records a participant action (join, leave, screen share, etc.)
// with optional metadata. NO clinical content is stored — only structural
// event data (who joined, when, connection drops, recording start/stop).
//
// `patient_arrived` marks the patient reaching the WAITING room (used for
// wait-time measurement and audit). It is distinct from `patient_joined`,
// which marks ADMISSION into the call once the therapist lets them in.
//
// RLS policies: SELECT + INSERT only (append-only — no update or delete).
export const videoSessionLogs = pgTable(
  'video_session_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `sessions`. Cross-schema reference emitted manually in migration.
    sessionId: uuid('session_id').notNull(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // Event type with CHECK constraint for valid values.
    eventType: varchar('event_type', { length: 30 }).notNull(),

    // Participant role (therapist, patient, or partner). Nullable because
    // some events (room_ended, room_expired) are system-level.
    participantRole: varchar('participant_role', { length: 20 }),

    // Structured metadata (e.g., connection quality, device info). NO PII.
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Timeline query: "all events for this session, in order".
    index('video_session_logs_session_id_created_at_idx').on(table.sessionId, table.createdAt),

    // RLS performance: SELECT policy filters by auth.uid() = user_id.
    index('video_session_logs_user_id_idx').on(table.userId),

    // Event type CHECK — enforces the 17 valid event types at DB level.
    check(
      'video_session_logs_event_type_check',
      sql`${table.eventType} IN (
        'therapist_joined', 'patient_joined', 'partner_joined',
        'patient_arrived',
        'therapist_left', 'patient_left', 'partner_left',
        'screen_share_started', 'screen_share_ended',
        'connection_drop', 'reconnected',
        'recording_started', 'recording_ended',
        'room_ended', 'room_expired',
        'session_summary', 'session_extended'
      )`,
    ),
  ],
);

export type VideoSessionLog = typeof videoSessionLogs.$inferSelect;
export type NewVideoSessionLog = typeof videoSessionLogs.$inferInsert;

// `video_recordings` tracks recording lifecycle for a telepsychology session.
// Status lifecycle: idle -> recording -> processing -> transcribed (or discarded).
// The `audio_temp_url` holds the temporary URL for the audio file before
// transcription. `transcription_id` will reference the future transcriptions
// table (PRD 10 — not yet created, so no FK constraint).
//
// RLS policies: SELECT + INSERT + UPDATE only (no delete — recordings are
// discarded via status change, not hard-deleted).
export const videoRecordings = pgTable(
  'video_recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `sessions`. Cross-schema reference emitted manually in migration.
    sessionId: uuid('session_id').notNull(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // Stream.io recording identifier.
    streamRecordingId: varchar('stream_recording_id', { length: 255 }),

    // Duration in seconds (populated after recording ends).
    durationSeconds: integer('duration_seconds'),

    // Recording lifecycle status. CHECK constraint enforces valid values.
    status: text('status').notNull().default('idle'),

    // Temporary URL for audio file (pre-transcription).
    audioTempUrl: text('audio_temp_url'),

    // Future FK to transcriptions table (PRD 10). Nullable, no FK yet.
    transcriptionId: uuid('transcription_id'),

    // When the recording was captured.
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }),

    // When the recording was discarded (soft-delete equivalent).
    discardedAt: timestamp('discarded_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Recording lookup: "all recordings for this session".
    index('video_recordings_session_id_idx').on(table.sessionId),

    // RLS performance: SELECT policy filters by auth.uid() = user_id.
    index('video_recordings_user_id_idx').on(table.userId),

    // Status CHECK — enforces the valid recording lifecycle states at DB level.
    check(
      'video_recordings_status_check',
      sql`${table.status} IN ('idle', 'recording', 'processing', 'transcribed', 'discarded')`,
    ),
  ],
);

export type VideoRecording = typeof videoRecordings.$inferSelect;
export type NewVideoRecording = typeof videoRecordings.$inferInsert;
