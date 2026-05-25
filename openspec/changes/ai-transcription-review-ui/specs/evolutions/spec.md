## ADDED Requirements

### Requirement: Evolutions carry an `ai_assisted` audit flag and an optional source transcription FK

The system SHALL extend the `evolutions` table with two columns:

- `ai_assisted boolean NOT NULL DEFAULT false` — marks evolutions whose initial content originated from an AI transcription.
- `ai_transcription_id uuid NULL REFERENCES ai_transcriptions(id) ON DELETE SET NULL` — backlink to the source transcription, where applicable.

The system SHALL extend `createEvolutionImpl` to accept optional parameters `{ aiAssisted?: boolean; aiTranscriptionId?: string | null }`. When `aiAssisted = true`, the inserted row's flag and FK SHALL be set accordingly. When omitted, behavior is unchanged.

The system SHALL create the index `idx_evolutions_user_ai_assisted` on `(user_id, ai_assisted)` for audit and statistics queries.

RLS on `evolutions` is unchanged — `user_id = auth.uid()` already enforces ownership for both columns.

#### Scenario: Backfill leaves existing evolutions valid
- **GIVEN** N existing rows in `evolutions`
- **WHEN** the migration applies
- **THEN** all N rows have `ai_assisted = false` and `ai_transcription_id = NULL`
- **AND** no row is deleted or unlinked

#### Scenario: AI-assisted evolution is created with the new fields
- **WHEN** `createEvolutionImpl` is invoked with `aiAssisted = true, aiTranscriptionId = '<tx>'`
- **THEN** the new row has the corresponding values

#### Scenario: Existing callers unaffected
- **WHEN** a caller from another module invokes `createEvolutionImpl` without the new options
- **THEN** the row is created with `ai_assisted = false` and `ai_transcription_id = NULL`
- **AND** all existing scenarios on the `evolutions` capability remain green

#### Scenario: Deleting the transcription nulls the FK without dropping the evolution
- **GIVEN** an evolution linked to a transcription row
- **WHEN** the transcription is deleted
- **THEN** the evolution's `ai_transcription_id` is NULL
- **AND** the evolution remains queryable
