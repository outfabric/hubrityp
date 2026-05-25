## ADDED Requirements

### Requirement: `ai-transcription` is a first-class schema domain re-exported by the union

The system SHALL add `src/shared/db/schema/ai-transcription/` as a new schema domain folder containing `tables.ts` (Drizzle table definitions for `ai_transcription_settings` and `ai_transcriptions`), `policies.ts` (RLS policy SQL helpers), and `index.ts` (domain barrel). The top-level `src/shared/db/schema/index.ts` SHALL re-export the new domain so that Drizzle Kit picks up the tables when generating migrations.

#### Scenario: Drizzle Kit discovers the new tables
- **WHEN** `npm run db:generate` runs after this change is applied
- **THEN** the generated migration includes `CREATE TABLE ai_transcription_settings` and `CREATE TABLE ai_transcriptions`

#### Scenario: Domain barrel is the only import path used outside this folder
- **WHEN** another module needs the table reference
- **THEN** it imports from `@/shared/db/schema` (top-level barrel) or `@/shared/db/schema/ai-transcription` (domain barrel)
- **AND** does not import from `@/shared/db/schema/ai-transcription/tables` directly

### Requirement: RLS for `ai-transcription` tables follows the owner-scoped template

The system SHALL enable RLS on both `ai_transcription_settings` and `ai_transcriptions` in the SAME migration that creates them, and SHALL create per-operation policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) using the template documented in the existing `data-layer` spec: `USING (user_id = auth.uid())` and `WITH CHECK (user_id = auth.uid())`. The migration SHALL NOT contain any policy with `USING (true)`.

#### Scenario: Eight policies exist after migration
- **WHEN** an integration test queries `pg_policies WHERE tablename IN ('ai_transcription_settings','ai_transcriptions')`
- **THEN** the result contains exactly eight rows (2 tables × 4 operations)
- **AND** every row's `qual` and `with_check` reference `auth.uid()`

#### Scenario: RLS isolates tenants under a real Supabase JWT
- **GIVEN** two real Supabase sessions belonging to different psychologists A and B
- **WHEN** psychologist A inserts a transcription row R
- **THEN** psychologist B's RLS-scoped client returns zero rows for `SELECT * FROM ai_transcriptions WHERE id = R.id`
- **AND** B's RLS-scoped client cannot UPDATE or DELETE R

### Requirement: Storage policies isolate audio objects by `auth.uid()` prefix

The system SHALL add `storage.objects` policies (`SELECT`, `INSERT`, `DELETE`) restricted to `bucket_id = 'ai-transcription-audio' AND (storage.foldername(name))[1] = auth.uid()::text`. The bucket SHALL be created as `public = false`.

#### Scenario: Bucket is private
- **WHEN** the migration completes
- **THEN** `SELECT public FROM storage.buckets WHERE id = 'ai-transcription-audio'` returns `false`

#### Scenario: Cross-tenant Storage read is blocked
- **GIVEN** an object at `userA/transcription123.webm`
- **WHEN** psychologist B (authenticated) calls `supabase.storage.from('ai-transcription-audio').download('userA/transcription123.webm')`
- **THEN** the call returns a not-found / authorization error
- **AND** no bytes are read

### Requirement: Operational indexes are part of the same migration

The system SHALL create three indexes in the same migration as the tables: `idx_ai_transcriptions_user_status`, `idx_ai_transcriptions_user_created`, and the partial index `idx_ai_transcriptions_audio_to_discard` (predicate: `audio_object_key IS NOT NULL AND audio_discarded_at IS NULL`).

#### Scenario: Partial index used by the discard query plan
- **WHEN** the equivalent of the discard cron query is run via `EXPLAIN`
- **THEN** the plan SHALL show an `Index Scan` (or `Bitmap Index Scan`) using `idx_ai_transcriptions_audio_to_discard`
- **AND** SHALL NOT show `Seq Scan` on `ai_transcriptions`
