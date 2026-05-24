## Requirements

### Requirement: Video rooms table stores 1:1 mapping between online sessions and Stream calls
The system SHALL maintain a `video_rooms` table with RLS enabled, storing one row per online session. Each row SHALL contain the Stream call ID, patient lookup token (64-char hex), patient JWT, partner token/JWT (for couple sessions), availability window (available_from, expires_at), recording flags, and room status. The `session_id` column SHALL be UNIQUE. RLS policies SHALL enforce `user_id = auth.uid()` for SELECT/INSERT/UPDATE/DELETE.

#### Scenario: Video room created for an online session
- **WHEN** a video room is created for a session with modality='online'
- **THEN** a row is inserted in `video_rooms` with status='pending', available_from = session.start_at - 10 minutes, expires_at = session.end_at + 1 hour, and a unique 64-char hex patient_token

#### Scenario: RLS prevents cross-user access to video rooms
- **WHEN** user B attempts to SELECT a video room owned by user A
- **THEN** the query returns zero rows

#### Scenario: Duplicate session_id is rejected
- **WHEN** an INSERT is attempted with a session_id that already has a video room
- **THEN** the database rejects the insert with a unique constraint violation

### Requirement: Video session logs table records call events as append-only metadata
The system SHALL maintain a `video_session_logs` table with RLS enabled. Each row SHALL record an event type (therapist_joined, patient_joined, partner_joined, therapist_left, patient_left, partner_left, screen_share_started, screen_share_ended, connection_drop, reconnected, recording_started, recording_ended, room_ended, room_expired, session_summary, session_extended), participant role, and optional non-PII metadata. The table SHALL be append-only (INSERT and SELECT only, no UPDATE or DELETE via RLS). Clinical content SHALL NOT be stored.

#### Scenario: Event logged when participant joins
- **WHEN** a therapist joins a video session
- **THEN** a row is inserted with event_type='therapist_joined', participant_role='therapist', and created_at timestamp

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
