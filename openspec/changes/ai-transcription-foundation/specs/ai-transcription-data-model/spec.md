## ADDED Requirements

### Requirement: `ai_transcription_settings` table holds per-psychologist transcription configuration

The system SHALL define an `ai_transcription_settings` table under the new `ai-transcription` schema domain (`src/shared/db/schema/ai-transcription/tables.ts`) with exactly one row per psychologist. The table SHALL include at minimum: `id` (uuid pk), `user_id` (uuid, NOT NULL, UNIQUE, FK to `auth.users` with `ON DELETE CASCADE`), `enabled` (boolean, default false), `default_template` (text, enum-validated against `'tcc' | 'psicanalise' | 'sistemica' | 'aba' | 'livre'`, default `'livre'`), `keep_audio_hours` (integer, default 24, CHECK `keep_audio_hours BETWEEN 24 AND 168`), `keep_transcription` (boolean, default false), `risk_detection_sensitivity` (text, enum-validated against `'low' | 'medium' | 'high'`, default `'medium'`), `created_at` and `updated_at` (timestamptz default now()).

#### Scenario: Default row is created on demand, not eagerly
- **WHEN** a psychologist signs up
- **THEN** no row is inserted in `ai_transcription_settings`
- **AND** the first time the user opens the AI transcription settings page the application MUST `upsert` a row with defaults

#### Scenario: User cannot have two settings rows
- **WHEN** an `INSERT` is attempted for a `user_id` that already has a row
- **THEN** the database returns a unique-constraint violation
- **AND** no duplicate row is created

#### Scenario: Cascade on user deletion
- **WHEN** a `auth.users` row is deleted
- **THEN** the matching `ai_transcription_settings` row is deleted by FK cascade

### Requirement: `ai_transcriptions` table holds one row per audio submission

The system SHALL define an `ai_transcriptions` table under the `ai-transcription` schema domain with one row per session audio submission. The table SHALL include at minimum: `id` (uuid pk), `user_id` (uuid, NOT NULL, FK to `auth.users`), `patient_id` (uuid, NOT NULL, FK to `patients`), `session_id` (uuid, NULLABLE, FK to `sessions` with `ON DELETE SET NULL`), `evolution_id` (uuid, NULLABLE, FK to `evolutions` with `ON DELETE SET NULL`), `source` (text, enum-validated against `'video_session' | 'manual_upload'`), `audio_object_key` (text, NULLABLE — null after discard), `audio_size_bytes` (bigint, NULLABLE), `audio_duration_seconds` (integer, NULLABLE), `audio_discarded_at` (timestamptz, NULLABLE), `template_used` (text, NULLABLE), `generated_note` (jsonb, NULLABLE), `risk_alerts` (jsonb, NULLABLE), `status` (text, enum-validated against `'pending' | 'transcribing' | 'generating' | 'ready' | 'reviewed' | 'failed'`, default `'pending'`), `error_code` (text, NULLABLE), `retry_count` (integer, default 0), `reviewed_at` (timestamptz, NULLABLE), `saved_to_prontuario` (boolean, default false), `user_edits_count` (integer, default 0), `created_at`, `updated_at` (timestamptz default now()), `completed_at` (timestamptz, NULLABLE).

#### Scenario: `patient_id` is required even when session is not yet linked
- **WHEN** a Server Action attempts to insert a row with `patient_id = NULL`
- **THEN** the database rejects with a NOT NULL violation

#### Scenario: Discarding the audio nulls the object key
- **WHEN** the Inngest discard job marks `audio_discarded_at = now()`
- **THEN** the same statement SHALL set `audio_object_key = NULL` so a future log line cannot reference a stale Storage path

#### Scenario: Status enum is enforced at DB level
- **WHEN** an `UPDATE` attempts to set `status = 'archived'`
- **THEN** the CHECK constraint rejects the update

#### Scenario: Deleting an evolution does not delete its transcription history
- **WHEN** a row in `evolutions` is deleted
- **THEN** the matching `ai_transcriptions.evolution_id` is set to NULL by FK
- **AND** the transcription audit row remains queryable

### Requirement: RLS is enabled and policies are scoped to `auth.uid()` on both tables

The system SHALL `ENABLE ROW LEVEL SECURITY` on `ai_transcription_settings` and `ai_transcriptions` in the same migration that creates them, and SHALL create explicit per-operation policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) for both tables. Every policy SHALL use the predicate `user_id = auth.uid()` for both `USING` and `WITH CHECK`. No policy SHALL use `USING (true)`.

#### Scenario: Cross-tenant read is blocked
- **GIVEN** psychologist A has a transcription row R
- **WHEN** psychologist B issues `SELECT * FROM ai_transcriptions WHERE id = R.id` via an RLS-scoped Supabase client
- **THEN** the query returns zero rows

#### Scenario: Cross-tenant write is blocked
- **GIVEN** psychologist A authenticated as themselves
- **WHEN** A attempts `INSERT INTO ai_transcriptions (user_id, ...) VALUES (B.id, ...)` (forging another user_id)
- **THEN** the `WITH CHECK` rejects the insert

#### Scenario: Service-role bypasses RLS for system jobs only
- **WHEN** the Inngest discard worker runs with the service-role key
- **THEN** it can read/update rows across tenants
- **AND** that usage is justified by a comment at the call site

### Requirement: Operational indexes support hot paths

The system SHALL create indexes that support the operational queries documented in PRD 10: filtering by status, finding audios eligible for discard, listing recent transcriptions per user. At minimum:

- `idx_ai_transcriptions_user_status` on `(user_id, status)` for the dashboard listing.
- `idx_ai_transcriptions_audio_to_discard` as a partial index on `(created_at)` `WHERE audio_object_key IS NOT NULL AND audio_discarded_at IS NULL`, for the discard cron.
- `idx_ai_transcriptions_user_created` on `(user_id, created_at DESC)` for chronological listing.

#### Scenario: Discard cron uses the partial index
- **GIVEN** thousands of rows where audio has already been discarded
- **WHEN** the cron query runs `SELECT id, audio_object_key FROM ai_transcriptions WHERE audio_object_key IS NOT NULL AND audio_discarded_at IS NULL AND created_at < now() - interval '24 hours'`
- **THEN** an `EXPLAIN` plan SHALL use `idx_ai_transcriptions_audio_to_discard` (Index Scan, not Seq Scan)

### Requirement: Private Storage bucket `ai-transcription-audio` is provisioned

The system SHALL create a private Supabase Storage bucket named `ai-transcription-audio` in the same migration set as the tables. The bucket SHALL NOT be public. Storage policies SHALL be defined for `SELECT`, `INSERT`, and `DELETE` operations on `storage.objects` such that `bucket_id = 'ai-transcription-audio'` AND `(storage.foldername(name))[1] = auth.uid()::text`.

#### Scenario: A user cannot list another tenant's audio prefix
- **GIVEN** an object at path `<userA>/<transcriptionId>.webm`
- **WHEN** psychologist B (authenticated) issues a `list` against the bucket
- **THEN** the object does not appear in B's results

#### Scenario: A signed URL is the only legitimate read path for the client
- **WHEN** the Server Action returns an audio URL to the browser
- **THEN** it MUST be a signed URL with TTL ≤ 5 minutes
- **AND** no public URL is ever returned
