## ADDED Requirements

### Requirement: `consent_terms` carries a kind discriminator

The system SHALL extend `consent_terms` with four columns: `kind` (`text NOT NULL CHECK kind IN ('general','ai_recording')`, default `'general'`), `revocation_takes_effect_immediately` (`boolean NOT NULL` — `false` for `general`, `true` for `ai_recording`), `revocation_reason` (`text NULL`), `template_version` (`integer NOT NULL DEFAULT 1`). The system SHALL also add the operational index `idx_consent_terms_user_patient_kind_revoked` on `(user_id, patient_id, kind, revoked_at)`.

#### Scenario: Backfill leaves existing rows valid
- **GIVEN** N pre-existing rows in `consent_terms`
- **WHEN** the migration runs
- **THEN** all N rows have `kind = 'general'`, `revocation_takes_effect_immediately = false`, `template_version = 1`
- **AND** none has been deleted or unlinked

#### Scenario: CHECK constraint blocks invalid kind
- **WHEN** an `INSERT` sets `kind = 'foo'`
- **THEN** the database rejects with a CHECK violation

#### Scenario: Index serves the consent lookup
- **GIVEN** thousands of consent rows
- **WHEN** the lookup `WHERE user_id = $1 AND patient_id = $2 AND kind = 'ai_recording' AND revoked_at IS NULL` runs
- **THEN** the query plan uses `idx_consent_terms_user_patient_kind_revoked`
