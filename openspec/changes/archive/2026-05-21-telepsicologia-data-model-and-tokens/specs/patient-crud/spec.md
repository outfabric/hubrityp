## MODIFIED Requirements

### Requirement: Patient record stores recording consent tracking
The `patients` table SHALL include `recording_consent_signed_at` (TIMESTAMPTZ, nullable) and `recording_consent_revoked_at` (TIMESTAMPTZ, nullable) columns. A patient with `recording_consent_signed_at IS NOT NULL` AND `recording_consent_revoked_at IS NULL` has active recording consent per Res. CFP 13/2022.

#### Scenario: Recording consent columns exist with correct types
- **WHEN** the migration is applied
- **THEN** the `patients` table has `recording_consent_signed_at` and `recording_consent_revoked_at` columns, both nullable TIMESTAMPTZ

#### Scenario: Active recording consent
- **WHEN** a patient has `recording_consent_signed_at = '2026-01-15'` and `recording_consent_revoked_at IS NULL`
- **THEN** the patient is considered to have active recording consent

#### Scenario: Revoked recording consent
- **WHEN** a patient has `recording_consent_signed_at = '2026-01-15'` and `recording_consent_revoked_at = '2026-03-01'`
- **THEN** the patient is NOT considered to have active recording consent
