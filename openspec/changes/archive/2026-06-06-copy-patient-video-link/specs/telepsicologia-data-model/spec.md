## MODIFIED Requirements

### Requirement: Video rooms table stores 1:1 mapping between online sessions and Stream calls

The system SHALL maintain a `video_rooms` table with RLS enabled, storing one row per online session. Each row SHALL contain the patient lookup token (64-char hex, NOT NULL), availability window (available_from, expires_at, NOT NULL), recording flags, and room status. The Stream call ID (`stream_call_id`) and patient JWT (`patient_jwt`) SHALL be nullable to support the "reserved" lifecycle state where the room is created at scheduling time but not yet activated on Stream.io. Partner token/JWT (for couple sessions) remain nullable as before. The `session_id` column SHALL be UNIQUE. RLS policies SHALL enforce `user_id = auth.uid()` for SELECT/INSERT/UPDATE/DELETE.

#### Scenario: Video room reserved at scheduling time (eager reservation)

- **WHEN** a video room is reserved for a session with modality='online' at scheduling time
- **THEN** a row is inserted in `video_rooms` with `status='pending'`, `stream_call_id=NULL`, `patient_jwt=NULL`, `available_from = session.start_at - 10 minutes`, `expires_at = session.end_at + 1 hour`, and a unique 64-char hex `patient_token`

#### Scenario: Reserved room activated by Inngest

- **WHEN** the Inngest auto-create handler activates a reserved room
- **THEN** the existing row is updated with `stream_call_id`, `patient_jwt`, and partner fields (if applicable), while `patient_token`, `available_from`, and `expires_at` remain unchanged

#### Scenario: RLS prevents cross-user access to video rooms

- **WHEN** user B attempts to SELECT a video room owned by user A
- **THEN** the query returns zero rows

#### Scenario: Duplicate session_id is rejected

- **WHEN** an INSERT is attempted with a session_id that already has a video room
- **THEN** the database rejects the insert with a unique constraint violation

#### Scenario: Nullable stream_call_id and patient_jwt are accepted

- **WHEN** a video room row is inserted with `stream_call_id=NULL` and `patient_jwt=NULL`
- **THEN** the INSERT succeeds and the row is persisted with NULL values for those columns
