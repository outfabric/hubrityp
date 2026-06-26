# telepsicologia-data-model Specification

## Purpose

Defines the persistence layer for telepsychology video sessions: the `video_rooms` table (1:1 mapping between online sessions and Stream calls, with a reserved-then-activated lifecycle), the append-only `video_session_logs` event table, and the ephemeral `video_recordings` lifecycle table — all with RLS enabled and per-operation policies scoped by `user_id = auth.uid()`.

## Requirements

### Requirement: Video rooms table stores 1:1 mapping between online sessions and Stream calls

The system SHALL maintain a `video_rooms` table with RLS enabled, storing one row per online session. Each row SHALL contain the patient lookup token (64-char hex, NOT NULL), availability window (available_from, expires_at, NOT NULL), recording flags, room status, a nullable `patient_waiting_at` timestamp recording the IMMUTABLE first moment the patient (or partner) reached the waiting state (set once, never updated thereafter), and a nullable `patient_last_seen_at` timestamp recording the MUTABLE liveness heartbeat (the most recent waiting poll). The Stream call ID (`stream_call_id`) and patient JWT (`patient_jwt`) SHALL be nullable to support the "reserved" lifecycle state where the room is created at scheduling time but not yet activated on Stream.io. Partner token/JWT (for couple sessions) remain nullable as before. The `session_id` column SHALL be UNIQUE. RLS policies SHALL enforce `user_id = auth.uid()` for SELECT/INSERT/UPDATE/DELETE.

#### Scenario: Video room reserved at scheduling time (eager reservation)

- **WHEN** a video room is reserved for a session with modality='online' at scheduling time
- **THEN** a row is inserted in `video_rooms` with `status='pending'`, `stream_call_id=NULL`, `patient_jwt=NULL`, `patient_waiting_at=NULL`, `patient_last_seen_at=NULL`, `available_from = session.start_at - 10 minutes`, `expires_at = session.end_at + 1 hour`, and a unique 64-char hex `patient_token`

#### Scenario: Reserved room activated by Inngest

- **WHEN** the Inngest auto-create handler activates a reserved room
- **THEN** the existing row is updated with `stream_call_id`, `patient_jwt`, and partner fields (if applicable), while `patient_token`, `available_from`, `expires_at`, `patient_waiting_at`, and `patient_last_seen_at` remain unchanged

#### Scenario: RLS prevents cross-user access to video rooms

- **WHEN** user B attempts to SELECT a video room owned by user A
- **THEN** the query returns zero rows

#### Scenario: Duplicate session_id is rejected

- **WHEN** an INSERT is attempted with a session_id that already has a video room
- **THEN** the database rejects the insert with a unique constraint violation

#### Scenario: Nullable stream_call_id and patient_jwt are accepted

- **WHEN** a video room row is inserted with `stream_call_id=NULL` and `patient_jwt=NULL`
- **THEN** the INSERT succeeds and the row is persisted with NULL values for those columns

#### Scenario: arrival and liveness timestamps default to NULL on a fresh room

- **WHEN** a video room row is inserted without explicit `patient_waiting_at` or `patient_last_seen_at`
- **THEN** the row is persisted with both `patient_waiting_at=NULL` and `patient_last_seen_at=NULL` (no patient has arrived yet)

#### Scenario: liveness heartbeat advances while first-arrival stays fixed

- **WHEN** `patient_last_seen_at` is updated multiple times for a room whose `patient_waiting_at` is already set
- **THEN** each update advances `patient_last_seen_at` while `patient_waiting_at` retains its original first-arrival value

### Requirement: Video session logs table records call events as append-only metadata
The system SHALL maintain a `video_session_logs` table with RLS enabled. Each row SHALL record an event type (therapist_joined, patient_arrived, patient_joined, partner_joined, therapist_left, patient_left, partner_left, screen_share_started, screen_share_ended, connection_drop, reconnected, recording_started, recording_ended, room_ended, room_expired, session_summary, session_extended), participant role, and optional non-PII metadata. The `patient_arrived` event SHALL be distinct from `patient_joined`: `patient_arrived` marks the patient reaching the waiting room, while `patient_joined` marks admission into the call, so wait time is measurable as the delta between them. The table SHALL be append-only (INSERT and SELECT only, no UPDATE or DELETE via RLS). Clinical content SHALL NOT be stored.

#### Scenario: Event logged when participant joins
- **WHEN** a therapist joins a video session
- **THEN** a row is inserted with event_type='therapist_joined', participant_role='therapist', and created_at timestamp

#### Scenario: Patient arrival is logged distinctly from admission

- **WHEN** a patient reaches the waiting room and is later admitted
- **THEN** a `patient_arrived` row and a separate `patient_joined` row both exist, allowing wait time to be computed from their `created_at` difference

#### Scenario: Invalid event type is rejected
- **WHEN** an INSERT is attempted with an event_type not in the allowed CHECK constraint set
- **THEN** the database rejects the insert

### Requirement: Video recordings table tracks ephemeral recording lifecycle
The system SHALL maintain a `video_recordings` table with RLS enabled. Each row SHALL track recording status (idle, recording, processing, transcribed, discarded), Stream recording ID, duration, temporary audio URL (expires in 24h), and optional transcription_id FK. The status CHECK constraint SHALL include the statuses 'idle', 'recording', 'processing', 'transcribed', 'discarded'. Recordings with status 'processing' or 'transcribed' and recorded_at older than 24 hours SHALL be eligible for cleanup. RLS policies SHALL allow SELECT/INSERT/UPDATE only (no DELETE) scoped by `user_id = auth.uid()`.

#### Scenario: Recording transitions through full lifecycle
- **WHEN** a recording starts, is processed, transcribed, and then cleaned up
- **THEN** the status transitions: idle -> recording -> processing -> transcribed -> discarded

#### Scenario: Recording status transitions through lifecycle
- **WHEN** a recording starts, is processed, and then discarded
- **THEN** the status transitions from 'idle' to 'recording' to 'processing' to 'discarded', with discarded_at and audio_temp_url=NULL set on final transition

### Requirement: All telepsicologia tables have RLS enabled with per-operation policies
Every table in `src/shared/db/schema/telepsicologia/` SHALL have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and explicit per-operation policies using `user_id = auth.uid()`. No `USING (true)` policies SHALL exist.

#### Scenario: RLS is enabled on all three tables
- **WHEN** the migration is applied
- **THEN** `video_rooms`, `video_session_logs`, and `video_recordings` all have RLS enabled with at least one policy per allowed operation

### Requirement: Patient presence heartbeat is broadcast to the owning psychologist over a private Realtime channel

The system SHALL deliver the patient-presence heartbeat to the owning psychologist via Supabase Realtime using Broadcast from Database on a PRIVATE channel, NOT via Postgres Changes (which would stream the full `video_rooms` row, exposing `patient_jwt` and the patient/partner tokens). A SECURITY DEFINER trigger on `video_rooms` SHALL fire when `patient_last_seen_at` changes (`NEW.patient_last_seen_at IS DISTINCT FROM OLD.patient_last_seen_at`) — including a clear back to NULL on patient departure, since `IS DISTINCT FROM` treats NULL as a value — and SHALL broadcast a minimal, secret-free payload containing only `room_id` and `last_seen_at` (which MAY be null to signal departure) on the topic `video-room:<room_id>`. An RLS policy on `realtime.messages` SHALL authorize receipt of that topic only for the psychologist who owns the room (`video_rooms.user_id = auth.uid()`). The trigger, its function, and the `realtime.messages` policy SHALL be created guardedly so migrations apply cleanly on a plain (non-Supabase) Postgres instance where the `realtime` schema and primitives are absent.

#### Scenario: Heartbeat change broadcasts a minimal payload

- **WHEN** `video_rooms.patient_last_seen_at` is updated to a new timestamp
- **THEN** a broadcast is emitted on topic `video-room:<room_id>` whose payload contains only `room_id` and `last_seen_at` and contains no JWT, token, patient name, or other PII

#### Scenario: Clearing the heartbeat broadcasts a departure (null) payload

- **WHEN** `video_rooms.patient_last_seen_at` is updated from a timestamp back to NULL (patient departure)
- **THEN** the trigger fires and broadcasts a payload with `last_seen_at` null on topic `video-room:<room_id>`, carrying no JWT, token, or PII

#### Scenario: Updates that do not change the heartbeat do not broadcast

- **WHEN** a `video_rooms` row is updated for admission, end, or expiry without changing `patient_last_seen_at`
- **THEN** no presence broadcast is emitted

#### Scenario: Only the owner may receive the presence broadcast

- **WHEN** an authenticated user who does not own the room attempts to subscribe to `video-room:<room_id>`
- **THEN** the `realtime.messages` RLS policy denies receipt and the user receives no presence messages for that room

#### Scenario: Migration is safe on non-Supabase Postgres

- **WHEN** the migration is applied to a plain Postgres instance without the `realtime` schema (e.g. Testcontainers/CI)
- **THEN** the migration completes without error, skipping the trigger and `realtime.messages` policy creation
